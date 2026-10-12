//! OmniTODO core: domain, persistence and services. No Tauri, no React, no MCP.

pub mod clock;
pub mod config;
pub mod db;
pub mod domain;
pub mod error;
pub mod service;

pub use error::{ApiError, CoreError};
