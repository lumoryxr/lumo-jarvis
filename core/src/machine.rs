//! Live telemetry for the workstation JARVIS runs on.
//!
//! `sysinfo` gives cross-platform CPU/memory/disk/network without shelling out.
//! The sampler keeps a rolling window per metric so the frontend's sparklines
//! have history the moment the UI attaches, rather than drawing from empty.

use std::collections::VecDeque;

use sysinfo::{Disks, Networks, System};

use crate::types::{MachineSnapshot, Metric, ProcessInfo, Tone};

/// How many samples each sparkline keeps. Matches the 48 points the SVG draws.
const WINDOW: usize = 48;

pub struct Sampler {
    system: System,
    networks: Networks,
    disks: Disks,
    history: [VecDeque<f32>; 4],
    /// Previous cumulative network counters, for per-tick deltas.
    last_net: (u64, u64),
    total_mem_gb: f32,
}

impl Default for Sampler {
    fn default() -> Self {
        Self::new()
    }
}

impl Sampler {
    pub fn new() -> Self {
        let mut system = System::new_all();
        system.refresh_all();
        let total_mem_gb = system.total_memory() as f32 / 1024.0 / 1024.0 / 1024.0;

        Self {
            system,
            networks: Networks::new_with_refreshed_list(),
            disks: Disks::new_with_refreshed_list(),
            history: std::array::from_fn(|_| VecDeque::with_capacity(WINDOW)),
            last_net: (0, 0),
            total_mem_gb,
        }
    }

    fn push(&mut self, slot: usize, v: f32) -> Vec<f32> {
        let h = &mut self.history[slot];
        if h.len() == WINDOW {
            h.pop_front();
        }
        h.push_back(v);
        // Left-pad so the sparkline is full-width from the first sample.
        let mut out = vec![v; WINDOW.saturating_sub(h.len())];
        out.extend(h.iter().copied());
        out
    }

    /// Take one sample. Call on a fixed interval — CPU usage is only meaningful
    /// as a delta between refreshes, so the first sample reads low.
    pub fn sample(&mut self) -> MachineSnapshot {
        self.system.refresh_cpu_usage();
        self.system.refresh_memory();
        self.system.refresh_processes(sysinfo::ProcessesToUpdate::All, true);
        self.networks.refresh(true);
        self.disks.refresh(true);

        // --- cpu -----------------------------------------------------------
        let cpu = self.system.global_cpu_usage() / 100.0;

        // --- memory ---------------------------------------------------------
        let used_gb = self.system.used_memory() as f32 / 1024.0 / 1024.0 / 1024.0;
        let mem = if self.total_mem_gb > 0.0 {
            used_gb / self.total_mem_gb
        } else {
            0.0
        };

        // --- disk -----------------------------------------------------------
        // Fullness rather than throughput: it is the number a user acts on, and
        // sysinfo does not expose per-tick IO uniformly across platforms.
        let (disk_used, disk_total): (u64, u64) = self
            .disks
            .iter()
            .fold((0, 0), |(u, t), d| {
                (u + (d.total_space() - d.available_space()), t + d.total_space())
            });
        let disk = if disk_total > 0 {
            disk_used as f32 / disk_total as f32
        } else {
            0.0
        };

        // --- network ---------------------------------------------------------
        let (rx, tx) = self
            .networks
            .iter()
            .fold((0u64, 0u64), |(r, t), (_, n)| (r + n.total_received(), t + n.total_transmitted()));
        let delta = (rx + tx).saturating_sub(self.last_net.0 + self.last_net.1);
        self.last_net = (rx, tx);
        // Scale against 125 MB/s (≈1 Gb/s) so a saturated link reads as full.
        let net_mb = delta as f32 / 1024.0 / 1024.0;
        let net = (net_mb / 125.0).clamp(0.0, 1.0);

        let metrics = vec![
            Metric {
                id: "cpu".into(),
                label: "CPU".into(),
                value: cpu,
                display: format!("{}%", (cpu * 100.0).round() as i32),
                history: self.push(0, cpu),
                tone: Tone::for_value(cpu),
            },
            Metric {
                id: "mem".into(),
                label: "MEMORY".into(),
                value: mem,
                display: format!("{used_gb:.1} GB"),
                history: self.push(1, mem),
                tone: Tone::for_value(mem),
            },
            Metric {
                id: "disk".into(),
                label: "DISK".into(),
                value: disk,
                display: format!("{}% used", (disk * 100.0).round() as i32),
                history: self.push(2, disk),
                tone: Tone::for_value(disk),
            },
            Metric {
                id: "net".into(),
                label: "NETWORK".into(),
                value: net,
                display: format!("{net_mb:.1} MB/s"),
                history: self.push(3, net),
                tone: Tone::for_value(net),
            },
        ];

        let mut processes: Vec<ProcessInfo> = self
            .system
            .processes()
            .values()
            .map(|p| ProcessInfo {
                pid: p.pid().as_u32(),
                name: p.name().to_string_lossy().into_owned(),
                cpu: p.cpu_usage().round() as u32,
                mem: (p.memory() as f32 / 1024.0 / 1024.0).round() as u32,
            })
            .collect();
        processes.sort_by(|a, b| b.cpu.cmp(&a.cpu));
        processes.truncate(12);

        MachineSnapshot {
            host: System::host_name().unwrap_or_else(|| "unknown".into()),
            os: format!(
                "{} {}",
                System::name().unwrap_or_else(|| "unknown".into()),
                System::os_version().unwrap_or_default()
            ),
            uptime_sec: System::uptime(),
            metrics,
            processes,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sample_is_well_formed() {
        let mut s = Sampler::new();
        let snap = s.sample();

        assert_eq!(snap.metrics.len(), 4);
        for m in &snap.metrics {
            assert!((0.0..=1.0).contains(&m.value), "{} out of range: {}", m.id, m.value);
            // A sparkline needs a full window from the very first sample.
            assert_eq!(m.history.len(), WINDOW);
        }
    }

    #[test]
    fn history_window_never_grows_past_cap() {
        let mut s = Sampler::new();
        for _ in 0..(WINDOW + 20) {
            s.sample();
        }
        assert!(s.history.iter().all(|h| h.len() == WINDOW));
    }

    #[test]
    fn tone_thresholds() {
        assert_eq!(Tone::for_value(0.5), Tone::Nominal);
        assert_eq!(Tone::for_value(0.75), Tone::Warn);
        assert_eq!(Tone::for_value(0.95), Tone::Critical);
    }
}
