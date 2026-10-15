//! Copy-ready MCP client snippets (design §11.1).
//!
//! Pure string building, so both shapes are unit-testable without a webview and
//! without a Tauri runtime. Two details here are load-bearing and easy to get
//! wrong, both of which shipped broken before:
//!
//! - **`command` is an absolute path.** The sidecar ships next to the app binary
//!   and is not on `PATH`, and ZCode does not expand `${...}` in configuration
//!   files, so a bare `omnitodo-mcp.exe` fails with `spawn … ENOENT`.
//! - **The token is unquoted.** MCP clients pass `args` straight to the process
//!   with no shell, so `--notify-token="abc"` reaches the server with the quotes
//!   attached and every notify callback is answered with 401.

use serde_json::{json, Value};

/// Everything a snippet needs; all paths must be absolute.
pub struct Snippet {
    pub bin: String,
    pub db: String,
    pub notify: String,
    pub token: String,
    pub write: bool,
}

impl Snippet {
    /// The `args` array, shared by both shapes so they cannot drift apart.
    fn args(&self) -> Vec<String> {
        let mut args = vec![
            "--db".to_string(),
            self.db.clone(),
            "--notify".to_string(),
            self.notify.clone(),
            "--notify-token".to_string(),
            self.token.clone(),
        ];
        if self.write {
            args.push("--write".to_string());
        }
        args
    }

    /// ZCode's user config: `~/.zcode/cli/config.json`, servers nested under
    /// `mcp.servers`.
    ///
    /// `.agents/mcp.json` is the compatibility fallback and takes a top-level
    /// `mcpServers` key instead — that is [`Self::generic`].
    pub fn zcode(&self) -> String {
        let doc = json!({
            "mcp": {
                "servers": {
                    "OmniTODO": {
                        "type": "stdio",
                        "command": self.bin,
                        "args": self.args(),
                    }
                }
            }
        });
        to_pretty(&doc)
    }

    /// The `mcpServers` shape most other clients read.
    pub fn generic(&self) -> String {
        let doc = json!({
            "mcpServers": {
                "omnitodo": {
                    "command": self.bin,
                    "args": self.args(),
                }
            }
        });
        to_pretty(&doc)
    }

    /// One line for ZCode's “参数（空格分隔）” form field, which is not a JSON
    /// input. Leads with the binary so the line doubles as a shell invocation
    /// that can be tried in a terminal to see the server's own error output.
    pub fn args_line(&self) -> String {
        std::iter::once(self.bin.clone())
            .chain(self.args())
            .collect::<Vec<_>>()
            .join(" ")
    }
}

fn to_pretty(v: &Value) -> String {
    serde_json::to_string_pretty(v).unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample(write: bool) -> Snippet {
        Snippet {
            bin: r"C:\Program Files\OmniTODO\omnitodo-mcp.exe".into(),
            db: r"C:\Users\admin\.omnitodo\omnitodo.db".into(),
            notify: "http://127.0.0.1:8788/internal/notify".into(),
            token: "01a13d2b4c6b73d59d4d1d5df84e0c7d01a13d2b4c6b73d59d4d1d5eec1f922a".into(),
            write,
        }
    }

    fn args_of(doc: &Value, path: &[&str]) -> Vec<String> {
        let mut cur = doc;
        for key in path {
            cur = cur.get(key).expect("path missing");
        }
        cur.as_array()
            .expect("args is an array")
            .iter()
            .map(|v| v.as_str().expect("arg is a string").to_string())
            .collect()
    }

    #[test]
    fn zcode_snippet_uses_the_nested_mcp_servers_shape() {
        let doc: Value = serde_json::from_str(&sample(false).zcode()).unwrap();
        assert_eq!(
            doc["mcp"]["servers"]["OmniTODO"]["command"],
            json!(r"C:\Program Files\OmniTODO\omnitodo-mcp.exe")
        );
        assert_eq!(doc["mcp"]["servers"]["OmniTODO"]["type"], json!("stdio"));
        // The top-level key belongs to `.agents/mcp.json`, not to `.zcode`.
        assert!(doc.get("mcpServers").is_none());
    }

    #[test]
    fn command_is_an_absolute_path() {
        let s = sample(false);
        let zcode: Value = serde_json::from_str(&s.zcode()).unwrap();
        let generic: Value = serde_json::from_str(&s.generic()).unwrap();
        let commands = [
            zcode["mcp"]["servers"]["OmniTODO"]["command"].as_str().unwrap(),
            generic["mcpServers"]["omnitodo"]["command"].as_str().unwrap(),
        ];
        for command in commands {
            assert_eq!(command, s.bin);
            assert!(
                command.contains('\\') || command.contains('/'),
                "command must be a path, got {command:?}"
            );
        }
    }

    #[test]
    fn token_is_never_quoted() {
        // The exact value has to survive as one array element: quotes, spaces or
        // any other decoration would become part of the bearer token and every
        // callback would be rejected with 401.
        for write in [false, true] {
            let s = sample(write);
            let doc: Value = serde_json::from_str(&s.zcode()).unwrap();
            let args = args_of(&doc, &["mcp", "servers", "OmniTODO", "args"]);
            let at = args.iter().position(|a| a == "--notify-token").unwrap();
            assert_eq!(args[at + 1], s.token);
            assert!(!args[at + 1].contains('"'));
            assert!(!args[at + 1].contains(' '));

            let line = s.args_line();
            assert!(line.contains(&format!("--notify-token {}", s.token)));
            assert!(!line.contains('"'));
        }
    }

    #[test]
    fn write_flag_appears_only_when_enabled() {
        let off = args_of(&serde_json::from_str(&sample(false).zcode()).unwrap(), &[
            "mcp",
            "servers",
            "OmniTODO",
            "args",
        ]);
        assert!(!off.contains(&"--write".to_string()));

        let on = args_of(&serde_json::from_str(&sample(true).zcode()).unwrap(), &[
            "mcp",
            "servers",
            "OmniTODO",
            "args",
        ]);
        assert_eq!(on.last().map(String::as_str), Some("--write"));

        let line = sample(true).args_line();
        assert!(line.ends_with(" --write"));
    }

    #[test]
    fn both_shapes_share_one_args_array() {
        let s = sample(true);
        let zcode: Value = serde_json::from_str(&s.zcode()).unwrap();
        let generic: Value = serde_json::from_str(&s.generic()).unwrap();
        assert_eq!(
            args_of(&zcode, &["mcp", "servers", "OmniTODO", "args"]),
            args_of(&generic, &["mcpServers", "omnitodo", "args"]),
        );
    }
}
