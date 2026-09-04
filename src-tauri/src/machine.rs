//! Machine snapshots via sysinfo. Real reads; mirrors the TS MachineSnapshot
//! shape so the React layer never has to adapt.

use crate::error::Result;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use sysinfo::{Disks, Process, System};
use parking_lot::Mutex;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DiskInfo {
    pub mount: String,
    pub total_gb: f32,
    pub free_gb: f32,
    pub label: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ProcessInfo {
    pub pid: u32,
    pub name: String,
    pub cpu_pct: f32,
    pub mem_mb: f32,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct MachineSnapshot {
    pub host: String,
    pub os: String,
    pub kernel: String,
    pub uptime_sec: u64,
    pub cpu_pct: f32,
    pub mem_total_mb: f32,
    pub mem_used_mb: f32,
    pub disks: Vec<DiskInfo>,
    pub processes: Vec<ProcessInfo>,
}

pub struct Machine {
    inner: Arc<Mutex<System>>,
}

impl Machine {
    pub fn new() -> Self {
        let mut s = System::new_all();
        s.refresh_all();
        Self { inner: Arc::new(Mutex::new(s)) }
    }

    pub fn snapshot(&self) -> Result<MachineSnapshot> {
        let mut s = self.inner.lock();
        s.refresh_all();

        let cpu = s.global_cpu_usage();
        let mem_used = s.used_memory() as f32 / 1024.0 / 1024.0;
        let mem_total = s.total_memory() as f32 / 1024.0 / 1024.0;
        let host = System::host_name().unwrap_or_else(|| "unknown".into());
        let os = System::long_os_version()
            .or_else(System::os_version)
            .unwrap_or_else(|| "unknown".into());
        let kernel = System::kernel_version().unwrap_or_else(|| "unknown".into());
        let uptime = System::uptime();

        let disks = Disks::new_with_refreshed_list()
            .iter()
            .map(|d| DiskInfo {
                mount: d.mount_point().to_string_lossy().into_owned(),
                total_gb: d.total_space() as f32 / 1024.0 / 1024.0 / 1024.0,
                free_gb: d.available_space() as f32 / 1024.0 / 1024.0 / 1024.0,
                label: d.name().to_string_lossy().into_owned(),
            })
            .collect();

        let processes = s
            .processes()
            .values()
            .take(40)
            .map(process_info)
            .collect();

        Ok(MachineSnapshot {
            host,
            os,
            kernel,
            uptime_sec: uptime,
            cpu_pct: cpu,
            mem_total_mb: mem_total,
            mem_used_mb: mem_used,
            disks,
            processes,
        })
    }
}

fn process_info(p: &Process) -> ProcessInfo {
    ProcessInfo {
        pid: p.pid().as_u32(),
        name: p.name().to_string_lossy().into_owned(),
        cpu_pct: p.cpu_usage(),
        mem_mb: p.memory() as f32 / 1024.0 / 1024.0,
    }
}

#[tauri::command]
pub async fn cmd_machine_snapshot() -> std::result::Result<MachineSnapshot, String> {
    let machine = Machine::new();
    machine.snapshot().map_err(Into::into)
}
