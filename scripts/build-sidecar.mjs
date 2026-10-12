// Builds the `omnitodo-mcp` MCP server and drops it into
// `omnitodo-desktop/binaries/` under the name Tauri expects for a sidecar
// (`<name>-<target-triple>`), so `bundle.externalBin` can pick it up.
//
//   node scripts/build-sidecar.mjs [--debug]
//
// The sidecar ships inside the installer / .app, so a packaged OmniTODO always
// has a matching MCP binary without a separate download (design §15).

import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const profile = process.argv.includes("--debug") ? "debug" : "release";

const cargoArgs = ["build", "--manifest-path", join(root, "Cargo.toml"), "-p", "omnitodo-mcp"];
if (profile === "release") cargoArgs.push("--release");

console.log(`> cargo ${cargoArgs.slice(1).join(" ")}`);
execFileSync("cargo", cargoArgs, { stdio: "inherit", cwd: root });

// Host target triple, as reported by the toolchain that just built the binary.
const triple = execFileSync("rustc", ["-vV"], { encoding: "utf8" })
  .split("\n")
  .find((l) => l.startsWith("host:"))
  .slice("host:".length)
  .trim();

const ext = triple.includes("windows") ? ".exe" : "";
const built = join(root, "target", profile, `omnitodo-mcp${ext}`);
const destDir = join(root, "omnitodo-desktop", "binaries");
const dest = join(destDir, `omnitodo-mcp-${triple}${ext}`);

mkdirSync(destDir, { recursive: true });
copyFileSync(built, dest);
console.log(`sidecar: ${built} -> ${dest} (${statSync(dest).size} bytes, triple ${triple})`);
