import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";

const CLI = new URL("../dist/cli.js", import.meta.url).pathname;
const EVIDENCE_CLI = new URL("../dist/evidence-cli.js", import.meta.url).pathname;
const SEMANTIC_DIFF_CLI = new URL("../dist/semantic-diff-cli.js", import.meta.url).pathname;

test("runs a Codex-compatible permission review end to end", async () => {
  const directory = await mkdtemp(join(tmpdir(), "jev-kit-cli-"));
  const configPath = join(directory, "policy.json");
  const transcriptPath = join(directory, "transcript.jsonl");
  const statusPath = join(directory, "status.json");
  await writeFile(configPath, JSON.stringify({
    schemaVersion: 1,
    policy: {
      id: "test.permission",
      version: "1",
      thresholds: { policyCompliant: 0.7, instructionAligned: 0.7, highRisk: 0.15 },
    },
    standingPolicy: "Allow requested local non-secret work.",
    userMessageCount: 4,
  }));
  await writeFile(transcriptPath, `${JSON.stringify({
    type: "response_item",
    payload: { type: "message", role: "user", content: [{ type: "input_text", text: "テストして" }] },
  })}\n`);
  await writeFile(statusPath, JSON.stringify({ schemaVersion: 1, counts: { "policy-allowed": 2 }, last: {} }));

  let calls = 0;
  const server = createServer((request, response) => {
    calls += 1;
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => { body += chunk; });
    request.on("end", () => {
      const parsed = JSON.parse(body);
      assert.equal(parsed.state.action.tool, "Bash");
      assert.deepEqual(parsed.state.context.userMessages, ["テストして"]);
      const output = JSON.stringify({
        model: "jev-test",
        usage: { input_tokens: 25, output_tokens: 3 },
        answers: {
          policy_compliant: { type: "noul", noul: 0.95 },
          instruction_aligned: { type: "noul", noul: 0.91 },
          high_risk: { type: "noul", noul: 0.02 },
        },
      });
      response.writeHead(200, { "content-type": "application/json", "content-length": Buffer.byteLength(output) });
      response.end(output);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.notEqual(address, null);
  const port = typeof address === "object" && address !== null ? address.port : 0;

  try {
    const result = await runCli([
      "--adapter", "codex-permission", "--config", configPath, "--status-file", statusPath,
    ], {
      session_id: "session-1",
      transcript_path: transcriptPath,
      cwd: directory,
      tool_name: "Bash",
      tool_input: { command: "pnpm test", description: "Run tests" },
    }, {
      TYPESAFE_API_KEY: "test-key",
      TYPESAFE_BASE_URL: `http://127.0.0.1:${port}`,
    });
    assert.equal(result.code, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), {
      hookSpecificOutput: { hookEventName: "PermissionRequest", decision: { behavior: "allow" } },
    });
    assert.equal(calls, 1);
    const status = JSON.parse(await readFile(statusPath, "utf8"));
    assert.equal(status.counts["policy-allowed"], 3);
    assert.equal(status.last.tool, "Bash");
    assert.equal(status.last.model, "jev-test");
    assert.deepEqual(status.last.usage, { input_tokens: 25, output_tokens: 3 });
    assert.ok(status.last.durationMs >= 0);
    assert.equal(JSON.stringify(status).includes("pnpm test"), false);
    const events = (await readFile(`${statusPath}.jsonl`, "utf8")).trim().split("\n").map((line) => JSON.parse(line));
    assert.deepEqual(events.map((event) => event.event), ["started", "finished"]);
    assert.equal(events[0].attemptId, events[1].attemptId);
    assert.equal(events[1].reason, "policy-allowed");
    assert.equal(events[1].stage, "review");
    assert.deepEqual(events[1].usage, status.last.usage);
    assert.equal(JSON.stringify(events).includes("pnpm test"), false);
    assert.equal(JSON.stringify(events).includes("テストして"), false);
    assert.equal(JSON.stringify(events).includes("test-key"), false);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test("records config and input-normalization failures without raw payloads", async () => {
  const directory = await mkdtemp(join(tmpdir(), "jev-kit-cli-"));
  const configPath = join(directory, "policy.json");
  const statusPath = join(directory, "status.json");
  await writeFile(configPath, "{invalid config");
  const configFailure = await runCli([
    "--adapter", "codex-permission", "--config", configPath, "--status-file", statusPath,
  ], {}, {});
  assert.equal(configFailure.code, 2);
  assert.equal(configFailure.stdout, "");
  let status = JSON.parse(await readFile(statusPath, "utf8"));
  assert.equal(status.last.stage, "config");
  assert.equal(status.last.errorKind, "SyntaxError");
  assert.equal(status.last.outcome, "error");
  assert.equal(Object.hasOwn(status.last, "usage"), false);

  await writePolicy(configPath);
  const invalidInput = { tool_name: "Bash", unrelated: "do not store this" };
  const inputFailure = await runCli([
    "--adapter", "codex-permission", "--config", configPath, "--status-file", statusPath,
  ], invalidInput, {});
  assert.equal(inputFailure.code, 2);
  assert.equal(inputFailure.stdout, "");
  status = JSON.parse(await readFile(statusPath, "utf8"));
  assert.equal(status.counts["cli-error"], 2);
  assert.equal(status.last.stage, "normalize");
  assert.equal(status.last.errorKind, "TypeError");
  assert.ok(status.last.durationMs >= 0);
  const journal = await readFile(`${statusPath}.jsonl`, "utf8");
  const events = journal.trim().split("\n").map((line) => JSON.parse(line));
  assert.deepEqual(events.map((event) => event.event), ["started", "finished", "started", "finished"]);
  assert.notEqual(events[0].attemptId, events[2].attemptId);
  assert.equal(journal.includes("do not store this"), false);
  assert.equal(journal.includes("invalid config"), false);
});

test("records local defer without inventing provider usage", async () => {
  const directory = await mkdtemp(join(tmpdir(), "jev-kit-cli-"));
  const configPath = join(directory, "policy.json");
  const statusPath = join(directory, "status.json");
  await writePolicy(configPath);
  const result = await runCli([
    "--adapter", "normalized", "--config", configPath, "--status-file", statusPath,
  ], {
    schemaVersion: 1, agent: { name: "custom-agent" }, event: { name: "permission-request" },
    action: { tool: "shell", input: { command: "cat /tmp/.env", password: "not-for-the-journal" } },
    context: { userMessages: ["inspect it"], standingPolicy: "Allow requested local non-secret work." },
  }, { TYPESAFE_API_KEY: "test-key" });
  assert.equal(result.code, 0, result.stderr);
  const status = JSON.parse(await readFile(statusPath, "utf8"));
  assert.equal(status.last.reason, "sensitive-input");
  assert.equal(Object.hasOwn(status.last, "model"), false);
  assert.equal(Object.hasOwn(status.last, "usage"), false);
  const journal = await readFile(`${statusPath}.jsonl`, "utf8");
  assert.equal(journal.includes("not-for-the-journal"), false);
  assert.equal(journal.includes("inspect it"), false);
});

test("journal write failure does not suppress an aggregate or permission result", async () => {
  const directory = await mkdtemp(join(tmpdir(), "jev-kit-cli-"));
  const configPath = join(directory, "policy.json");
  const statusPath = join(directory, "status.json");
  await writePolicy(configPath);
  await mkdir(`${statusPath}.jsonl`);
  const result = await runCli([
    "--adapter", "normalized", "--config", configPath, "--status-file", statusPath,
  ], {
    schemaVersion: 1, agent: { name: "custom-agent" }, event: { name: "permission-request" },
    action: { tool: "shell", input: {} },
    context: { userMessages: [], standingPolicy: "Allow requested local non-secret work." },
  }, { TYPESAFE_API_KEY: "test-key" });
  assert.equal(result.code, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).reason, "context-unavailable");
  const status = JSON.parse(await readFile(statusPath, "utf8"));
  assert.equal(status.counts["context-unavailable"], 1);
});

test("records a single provider failure without usage or retry", async () => {
  const directory = await mkdtemp(join(tmpdir(), "jev-kit-cli-"));
  const configPath = join(directory, "policy.json");
  const statusPath = join(directory, "status.json");
  await writePolicy(configPath);
  let calls = 0;
  const server = createServer((_request, response) => {
    calls += 1;
    response.writeHead(503, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: "synthetic unavailable" }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address !== null && typeof address === "object");
  try {
    const result = await runCli([
      "--adapter", "normalized", "--config", configPath, "--status-file", statusPath,
    ], {
      schemaVersion: 1, agent: { name: "custom-agent" }, event: { name: "permission-request" },
      action: { tool: "shell", input: { command: "pnpm test" } },
      context: { userMessages: ["run tests"], standingPolicy: "Allow requested local non-secret work." },
    }, { TYPESAFE_API_KEY: "test-key", TYPESAFE_BASE_URL: `http://127.0.0.1:${address.port}` });
    assert.equal(result.code, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).reason, "provider-unavailable");
    assert.equal(calls, 1);
    const status = JSON.parse(await readFile(statusPath, "utf8"));
    assert.equal(status.last.reason, "provider-unavailable");
    assert.equal(status.last.stage, "review");
    assert.equal(Object.hasOwn(status.last, "usage"), false);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test("an interrupted CLI leaves a start event without inventing a result", async () => {
  const directory = await mkdtemp(join(tmpdir(), "jev-kit-cli-"));
  const configPath = join(directory, "policy.json");
  const statusPath = join(directory, "status.json");
  await writePolicy(configPath);
  const child = spawn(process.execPath, [
    CLI, "--adapter", "codex-permission", "--config", configPath, "--status-file", statusPath,
  ], { stdio: ["pipe", "ignore", "ignore"] });
  const closed = new Promise<void>((resolve) => child.on("close", () => resolve()));
  try {
    let started = false;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const journal = await readFile(`${statusPath}.jsonl`, "utf8").catch(() => "");
      if (journal.endsWith("\n")) {
        started = JSON.parse(journal.trim()).event === "started";
        break;
      }
      await delay(10);
    }
    assert.equal(started, true);
    child.kill("SIGTERM");
    await closed;
    const events = (await readFile(`${statusPath}.jsonl`, "utf8")).trim().split("\n").map((line) => JSON.parse(line));
    assert.deepEqual(events.map((event) => event.event), ["started"]);
    assert.equal(Object.hasOwn(events[0], "outcome"), false);
    await assert.rejects(readFile(statusPath), { code: "ENOENT" });
  } finally {
    child.kill("SIGTERM");
    await closed;
  }
});

async function writePolicy(path: string): Promise<void> {
  await writeFile(path, JSON.stringify({
    schemaVersion: 1,
    policy: { id: "test.permission", version: "1", thresholds: { policyCompliant: 0.7, instructionAligned: 0.7, highRisk: 0.15 } },
    standingPolicy: "Allow requested local non-secret work.",
  }));
}

test("returns normalized defer JSON for sensitive input without a provider call", async () => {
  const directory = await mkdtemp(join(tmpdir(), "jev-kit-cli-"));
  const configPath = join(directory, "policy.json");
  await writeFile(configPath, JSON.stringify({
    schemaVersion: 1,
    policy: {
      id: "test.permission", version: "1",
      thresholds: { policyCompliant: 0.7, instructionAligned: 0.7, highRisk: 0.15 },
    },
    standingPolicy: "Allow requested local non-secret work.",
  }));
  const result = await runCli([
    "--adapter", "normalized", "--config", configPath, "--status-file", "/dev/null/status.json",
  ], {
    schemaVersion: 1,
    agent: { name: "custom-agent" },
    event: { name: "permission-request" },
    action: { tool: "shell", input: { command: "cat /tmp/.env" } },
    context: { userMessages: ["inspect it"], standingPolicy: "Allow requested local non-secret work." },
  }, { TYPESAFE_API_KEY: "test-key" });
  assert.equal(result.code, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).reason, "sensitive-input");
});

test("runs a caller-defined evidence check over JSON stdin", async () => {
  const { baseUrl, close, getRequest } = await startJevServer({
    claim_supported: { type: "noul", noul: 0.93 },
  });
  try {
    const result = await runJsonCli(EVIDENCE_CLI, {
      schemaVersion: 1,
      evidence: { test: "passed" },
      claim: "The test passed.",
      contract: {
        id: "test.evidence",
        version: "1",
        axes: [{ id: "claim_supported", instructions: "Does the evidence support the exact claim?" }],
      },
      model: "jev-test",
    }, { TYPESAFE_API_KEY: "test-key", TYPESAFE_BASE_URL: baseUrl });
    assert.equal(result.code, 0, result.stderr);
    const output = JSON.parse(result.stdout);
    assert.equal(output.status, "evaluated");
    assert.equal(output.scores.claim_supported, 0.93);
    assert.equal(getRequest().state.proposed_claim, "The test passed.");
    assert.deepEqual(Object.keys(getRequest().questions), ["claim_supported"]);
  } finally {
    await close();
  }
});

test("runs a caller-defined semantic diff over JSON stdin", async () => {
  const { baseUrl, close, getRequest } = await startJevServer({
    material_violation: { type: "noul", noul: 0.08 },
    layout_changed: { type: "noul", noul: 0.87 },
  });
  try {
    const result = await runJsonCli(SEMANTIC_DIFF_CLI, {
      schemaVersion: 1,
      before: { requirements: ["Keep the layout"] },
      after: { artifact: "candidate" },
      contract: {
        id: "test.artifact",
        version: "1",
        dimensions: [
          { id: "material_violation", instructions: "Does the candidate violate a requirement?" },
          { id: "layout_changed", instructions: "Did the layout change?" },
        ],
      },
    }, { TYPESAFE_API_KEY: "test-key", TYPESAFE_BASE_URL: baseUrl });
    assert.equal(result.code, 0, result.stderr);
    const output = JSON.parse(result.stdout);
    assert.equal(output.status, "evaluated");
    assert.deepEqual(output.scores, { material_violation: 0.08, layout_changed: 0.87 });
    assert.deepEqual(Object.keys(getRequest().questions), ["material_violation", "layout_changed"]);
  } finally {
    await close();
  }
});

async function runCli(
  args: readonly string[],
  input: unknown,
  env: Record<string, string>,
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  const child = spawn(process.execPath, [CLI, ...args], {
    env: { ...process.env, ...env },
    stdio: ["pipe", "pipe", "pipe"],
  });
  child.stdin.end(JSON.stringify(input));
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8").on("data", (chunk) => { stdout += chunk; });
  child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += chunk; });
  const code = await new Promise<number | null>((resolve) => child.on("close", resolve));
  return { code, stdout, stderr };
}

async function runJsonCli(
  executable: string,
  input: unknown,
  env: Record<string, string>,
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  const child = spawn(process.execPath, [executable], {
    env: { ...process.env, ...env },
    stdio: ["pipe", "pipe", "pipe"],
  });
  child.stdin.end(JSON.stringify(input));
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8").on("data", (chunk) => { stdout += chunk; });
  child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += chunk; });
  const code = await new Promise<number | null>((resolve) => child.on("close", resolve));
  return { code, stdout, stderr };
}

async function startJevServer(answers: Record<string, unknown>): Promise<{
  baseUrl: string;
  close: () => Promise<void>;
  getRequest: () => any;
}> {
  let received: any;
  const server = createServer((request, response) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => { body += chunk; });
    request.on("end", () => {
      received = JSON.parse(body);
      const output = JSON.stringify({
        model: "jev-test",
        usage: { input_tokens: 20, output_tokens: 2 },
        answers,
      });
      response.writeHead(200, { "content-type": "application/json", "content-length": Buffer.byteLength(output) });
      response.end(output);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.notEqual(address, null);
  const port = typeof address === "object" && address !== null ? address.port : 0;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
    getRequest: () => received,
  };
}
