//! Machine snapshots via sysinfo.
//!
//! M1: real reads on demand + 1s interval tick that emits `machine` events
//! to the frontend via window.emit("lumo://event", ...). Skeleton here.

use serde::Serialize;
use sysinfo::{System, SystemExt, ProcessorExt, DiskExt};

#[derive(Debug, Serialize, Clone)]
pub struct MachineSnapshot {
    pub cpu_pct: f32,
    pub mem_used_mb: f32,
    pub mem_total_mb: f32,
    pub processes: Vec<ProcessInfo>,
}

#[derive(Debug, Serialize, Clone)]
pub struct ProcessInfo {
    pub pid: u32,
    pub name: String,
    pub cpu: f32,
    pub mem: f32,
}

#[tauri::command]
pub async fn cmd_machine_snapshot() -> Result<MachineSnapshot, String> {
    let mut sys = System::new_all();
    sys.refresh_all();
    let cpu = sys.global_processor_info().cpu_usage();
    let mem_used = sys.used_memory() as f32 / 1024.0 / 1024.0;
    let mem_total = sys.total_memory() as f32 / 1024.0 / 1024.0;
    let procs: Vec<ProcessInfo> = sys.processes().iter().take(20).map(|p| ProcessInfo {
        pid: p.pid(),
        name: p.name().to_string(),
        cpu: p.cpu_usage(),
        mem: p.memory() as f32 / 1024.0 / 1024.0,
    }).collect();
    let _disks: Vec<_> = sys.disks().iter().collect();
    Ok(MachineSnapshot { cpu_pct: cpu, mem_used_mb: mem_used, mem_total_mb: mem_total, processes: procs })
}
