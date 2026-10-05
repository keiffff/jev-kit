import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

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

test("page UI metadata does not displace actual requests", () => {
  const transcript = ["対象は /workspace/input-a.txt だけです", '<external_codex_apps_open_page>{"page_id":null}</external_codex_apps_open_page>', "ファイルの内容を確認して"]
    .map((text) => JSON.stringify({ role: "user", content: text })).join("\n");
  assert.deepEqual(extractLatestUserMessages(transcript, 2), ["対象は /workspace/input-a.txt だけです", "ファイルの内容を確認して"]);
});

test("retains earlier target constraints and role-separated context for a short reply", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "jev-conversation-"));
  t.after(() => rm(directory, { recursive: true }));
  const transcript = join(directory, "transcript.jsonl");
  const records = [
    { role: "user", content: "対象は /workspace/input-a.txt だけです" },
    { role: "user", content: "内容を読んで" },
    { role: "user", content: "行数を確認して" },
    { role: "user", content: "結果を説明して" },
    { role: "assistant", content: "指定されたファイルの内容を確認します。" },
    { role: "user", content: "お願いします" },
    { role: "assistant", content: "まず読み取りコマンドの使い方を確認します。" },
    { role: "assistant", channel: "analysis", content: "private reasoning" },
    { role: "user", content: '<external_codex_apps_open_page>{"page_id":null}</external_codex_apps_open_page>' },
  ];
  await writeFile(transcript, records.map((r) => JSON.stringify(r)).join("\n"));
  const request = await fromCodexPermissionRequest({ transcript_path: transcript, tool_name: "Bash", tool_input: { command: "wc --help" } }, { standingPolicy: "Keep the requested target.", userMessageCount: 4 });
  assert.deepEqual(request.context.previousUserMessages, ["対象は /workspace/input-a.txt だけです"]);
  assert.equal(request.context.userMessages.at(-1), "お願いします");
  assert.deepEqual(request.context.assistantMessages, ["指定されたファイルの内容を確認します。", "まず読み取りコマンドの使い方を確認します。"]);
});

test("terminal interruption includes its originating command but never output", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "jev-terminal-"));
  t.after(() => rm(directory, { recursive: true }));
  const transcript = join(directory, "transcript.jsonl");
  await writeFile(transcript, [
    { role: "user", content: "表示がないので、自分のターミナルから入力します" },
    { type: "event_msg", payload: { type: "item_completed", item: { process_id: "42", command: ["/bin/sh", "-c", "read -r value"], stdout: "never send terminal output", stderr: "never send errors" } } },
    { type: "event_msg", payload: { type: "item_completed", item: { process_id: "43", command: "unrelated process" } } },
  ].map((r) => JSON.stringify(r)).join("\n"));
  const request = await fromCodexPermissionRequest({ transcript_path: transcript, tool_name: "write_stdin", tool_input: { session_id: 42, chars: "\u0003" } }, { standingPolicy: "Follow the request." });
  assert.deepEqual(request.context.relatedAction, { tool: "Bash", input: { command: ["/bin/sh", "-c", "read -r value"] } });
  assert.equal(JSON.stringify(request).includes("never send"), false);
});

test("direct script inspection includes source without running or following imports", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "jev-script-"));
  t.after(() => rm(directory, { recursive: true }));
  const script = join(directory, "inspect.sh");
  const content = "#!/bin/sh\n# Inspect the requested file.\nexit 77\n";
  await writeFile(script, content);
  const request = await fromCodexPermissionRequest({ cwd: directory, tool_name: "Bash", tool_input: { command: ["/bin/sh", "-c", "./inspect.sh input-a.txt"] } }, { standingPolicy: "Requested read-only analysis.", userMessages: ["内容を確認して"] });
  assert.deepEqual(request.context.actionSources, [{ path: script, content }]);
  const unrelated = await fromCodexPermissionRequest({ cwd: directory, tool_name: "Bash", tool_input: { command: "echo ./inspect.sh" } }, { standingPolicy: "Follow the request.", userMessages: ["確認して"] });
  assert.equal(unrelated.context.actionSources, undefined);
});

test("interruption resolves a still-running command from its yielded session, not future completion", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "jev-yielded-terminal-"));
  t.after(() => rm(directory, { recursive: true }));
  const transcript = join(directory, "transcript.jsonl");
  await writeFile(transcript, [
    { role: "user", content: "こちらで入力するので停止して" },
    { type: "response_item", payload: { type: "custom_tool_call", name: "exec", call_id: "call-1", input: 'const r = await tools.exec_command({cmd:"read -r value",tty:true}); text(r.output); text(`SESSION_ID=${r.session_id}`);' } },
    { type: "response_item", payload: { type: "custom_tool_call_output", call_id: "call-1", output: { content: [{ type: "text", text: "Do not forward terminal contents" }, { type: "text", text: "SESSION_ID=42" }] } } },
  ].map((r) => JSON.stringify(r)).join("\n"));
  const request = await fromCodexPermissionRequest({ transcript_path: transcript, tool_name: "write_stdin", tool_input: { session_id: 42, chars: "\u0003" } }, { standingPolicy: "Follow the current request." });
  assert.deepEqual(request.context.relatedAction, { tool: "Bash", input: { command: "read -r value" } });
  assert.equal(JSON.stringify(request).includes("Do not forward terminal contents"), false);
});
