import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const CLI = new URL("../dist/cli.js", import.meta.url).pathname;

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
