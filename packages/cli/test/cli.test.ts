import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

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
    assert.equal(status.counts["policy-allowed"], 1);
    assert.equal(status.last.tool, "Bash");
    assert.equal(JSON.stringify(status).includes("pnpm test"), false);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

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
