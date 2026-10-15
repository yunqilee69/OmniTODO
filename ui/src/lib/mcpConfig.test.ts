import { describe, expect, it } from "vitest";
import {
  CAPABILITY_GROUPS,
  READ_TOOLS,
  TOKEN_MAX_LEN,
  WRITE_TOOLS,
  validateToken,
} from "./mcpConfig";

describe("capability table", () => {
  it("covers exactly the tools the server registers", () => {
    // Mirrors `crates/omnitodo-mcp/src/tools.rs`. A tool added there without a
    // row here would be invisible to users, which is the drift this catches.
    const readRows = CAPABILITY_GROUPS.filter((g) => g.mode === "read").flatMap((g) => g.tools);
    const writeRows = CAPABILITY_GROUPS.filter((g) => g.mode === "write").flatMap((g) => g.tools);
    expect(readRows.sort()).toEqual([...READ_TOOLS].sort());
    expect(writeRows.sort()).toEqual([...WRITE_TOOLS].sort());
  });

  it("lists every tool exactly once", () => {
    const all = CAPABILITY_GROUPS.flatMap((g) => g.tools);
    expect(new Set(all).size).toBe(all.length);
  });

  it("keeps the documented tool counts", () => {
    expect(READ_TOOLS).toHaveLength(13);
    expect(WRITE_TOOLS).toHaveLength(7);
  });
});

describe("validateToken", () => {
  it("accepts a generated token", () => {
    // What `generate_token()` produces: two UUID v7s, separators stripped.
    expect(validateToken("01a13d2b4c6b73d59d4d1d5df84e0c7d01a13d2b4c6b73d59d4d1d5eec1f922a")).toBeNull();
    expect(validateToken("my-own_token_0123456789")).toBeNull();
  });

  it("rejects the quoting mistake that broke callbacks", () => {
    // Pasting the token into an MCP client config with quotes attached used to
    // reach the server with the quotes included, so every callback got a 401.
    expect(validateToken('"01a13d2b4c6b73d59d4d1d5df84e0c7d"')).toMatch(/只能包含/);
  });

  it("rejects values that cannot travel in an Authorization header", () => {
    expect(validateToken("has space 0123456789")).toMatch(/只能包含/);
    expect(validateToken("token-中文-0123456789")).toMatch(/只能包含/);
    expect(validateToken("")).toMatch(/长度/);
    expect(validateToken("short")).toMatch(/长度/);
    expect(validateToken("x".repeat(TOKEN_MAX_LEN + 1))).toMatch(/长度/);
  });

  it("bounds the length at both ends", () => {
    expect(validateToken("x".repeat(TOKEN_MAX_LEN))).toBeNull();
    expect(validateToken("x".repeat(TOKEN_MAX_LEN - 1))).toBeNull();
  });
});
