//! Minimal, spec-shaped MCP server over JSON-RPC 2.0 (design §11).

pub mod protocol;
pub mod tools;

pub use tools::{ToolContext, READ_TOOLS, WRITE_TOOLS};
