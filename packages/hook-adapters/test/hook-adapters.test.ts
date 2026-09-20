import assert from "node:assert/strict";
import test from "node:test";

import {
  extractLatestUserMessages,
  fromClaudeCodePermissionRequest,
  fromCodexPermissionRequest,
  renderPermissionHookResult,
} from "../src/index.ts";

test("normalizes the Codex permission payload without flattening tool input", async () => {
  const request = await fromCodexPermissionRequest({
    session_id: "session-1",
    cwd: "/workspace",
    tool_name: "Bash",
    tool_input: { command: "pnpm test", justification: "Run tests" },
  }, {
    standingPolicy: "Allow requested local work.",
    userMessages: ["テストして"],
  });
  assert.equal(request.agent.name, "codex");
  assert.equal(request.requestId, "session-1");
  assert.deepEqual(request.action.input, { command: "pnpm test", justification: "Run tests" });
  assert.equal(request.action.description, "Run tests");
});

test("normalizes the documented Claude Code PermissionRequest shape", async () => {
  const request = await fromClaudeCodePermissionRequest({
    session_id: "abc123",
    transcript_path: "/missing/transcript.jsonl",
    cwd: "/workspace",
    hook_event_name: "PermissionRequest",
    tool_name: "Bash",
    tool_input: { command: "pnpm test", description: "Run tests" },
  }, { standingPolicy: "Allow requested local work." });
  assert.equal(request.agent.name, "claude-code");
  assert.deepEqual(request.context.userMessages, []);
});

test("rejects a hook payload that omits tool_input", async () => {
  await assert.rejects(fromCodexPermissionRequest({
    tool_name: "Bash",
  }, {
    standingPolicy: "Allow requested local work.",
    userMessages: ["テストして"],
  }), /tool_input is required/);
});

test("extracts Codex and Claude user records and removes injected policy messages", () => {
  const transcript = [
    { type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "first" }] } },
    { type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "# AGENTS.md instructions\nsynthetic" }] } },
    { type: "user", message: { role: "user", content: "second" } },
  ].map((line) => JSON.stringify(line)).join("\n");
  assert.deepEqual(extractLatestUserMessages(transcript, 2), ["first", "second"]);
});

test("renders allow in the shared permission hook format and stays silent on defer", () => {
  const base = { schemaVersion: 1 as const, contract: { id: "x", version: "1" } };
  assert.deepEqual(renderPermissionHookResult({ ...base, outcome: "allow", reason: "policy-allowed" }), {
    hookSpecificOutput: { hookEventName: "PermissionRequest", decision: { behavior: "allow" } },
  });
  assert.equal(renderPermissionHookResult({ ...base, outcome: "defer", reason: "provider-unavailable" }), undefined);
});
