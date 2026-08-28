//! Core logic for Lumo JARVIS, kept free of any GUI dependency.
//!
//! Splitting this out of `src-tauri` means the parts that actually touch the
//! machine and the Hermes gateway can be built and tested on any host, without
//! a system webview installed. The Tauri crate is a thin binding over this.

pub mod hermes;
pub mod machine;
pub mod types;

pub use types::*;
