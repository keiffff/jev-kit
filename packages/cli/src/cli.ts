#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { appendFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import {
  definePermissionReviewPolicy,
  reviewAgentAction,
  unavailableReviewResult,
  validateAgentReviewRequest,
} from "@jev-kit/agent-review";
import type { AgentReviewRequest, AgentReviewResult } from "@jev-kit/agent-review";
import { JevClient } from "@jev-kit/decision-contract";
import {
  fromClaudeCodePermissionRequest,
  fromCodexPermissionRequest,
  renderPermissionHookResult,
} from "@jev-kit/hook-adapters";
import { parseCliConfig } from "./index.js";

type Adapter = "normalized" | "codex-permission" | "claude-permission";

interface Arguments {
  adapter: Adapter;
  configPath: string;
  statusFile?: string;
}

type ReviewStage = "config" | "input" | "normalize" | "review";
interface StatusEvent {
  schemaVersion: 1;
  attemptId: string;
  event: "started" | "finished";
  at: string;
  adapter: Adapter;
  durationMs?: number;
  stage?: ReviewStage;
  tool?: string;
  outcome?: AgentReviewResult["outcome"] | "error";
  reason?: AgentReviewResult["reason"] | "cli-error";
  contract?: AgentReviewResult["contract"];
  scores?: AgentReviewResult["scores"];
  model?: AgentReviewResult["model"];
  usage?: AgentReviewResult["usage"];
  errorKind?: string;
}

async function main(): Promise<void> {
  const started = performance.now();
  const args = parseArguments(process.argv.slice(2));
  const attemptId = randomUUID();
  const record = async (event: Omit<StatusEvent, "schemaVersion" | "attemptId" | "at" | "adapter">) => {
    if (args.statusFile === undefined) return;
    try {
      await recordStatus(args.statusFile, {
        schemaVersion: 1, attemptId, at: new Date().toISOString(), adapter: args.adapter, ...event,
      });
    } catch {
      // Observability must not change the permission decision or CLI failure.
    }
  };
  await record({ event: "started" });
  let stage: ReviewStage = "config";
  let tool: string | undefined;
  try {
    const config = parseCliConfig(JSON.parse(await readFile(args.configPath, "utf8")));
    const policy = definePermissionReviewPolicy(config.policy);
    stage = "input";
    const inputText = await readStdin();
    if (inputText.trim() === "") throw new TypeError("stdin must contain one JSON document");
    const rawInput = JSON.parse(inputText) as unknown;
    stage = "normalize";
    const request = await normalizeRequest(args.adapter, rawInput, config);
    tool = request.action.tool;
    stage = "review";
    let result: AgentReviewResult;
    try {
      const client = new JevClient({ ...(config.model === undefined ? {} : { defaultModel: config.model }) });
      result = await reviewAgentAction({ client, policy, request });
    } catch (error) {
      if (error instanceof TypeError) throw error;
      result = unavailableReviewResult(policy, error instanceof Error ? error.name : "unknown");
    }
    await record({ event: "finished", ...result, tool, stage, durationMs: performance.now() - started });
    if (args.adapter === "normalized") {
      process.stdout.write(`${JSON.stringify(result)}\n`);
      return;
    }
    const hookOutput = renderPermissionHookResult(result);
    if (hookOutput !== undefined) process.stdout.write(`${JSON.stringify(hookOutput)}\n`);
  } catch (error) {
    await record({
      event: "finished", outcome: "error", reason: "cli-error", stage,
      durationMs: performance.now() - started,
      ...(tool === undefined ? {} : { tool }),
      errorKind: error instanceof Error ? error.name : "unknown",
    });
    throw error;
  }
}

async function normalizeRequest(
  adapter: Adapter,
  input: unknown,
  config: ReturnType<typeof parseCliConfig>,
): Promise<AgentReviewRequest> {
  if (adapter === "normalized") {
    validateAgentReviewRequest(input);
    return input;
  }
  const options = {
    standingPolicy: config.standingPolicy,
    ...(config.userMessageCount === undefined ? {} : { userMessageCount: config.userMessageCount }),
  };
  return adapter === "codex-permission"
    ? fromCodexPermissionRequest(input, options)
    : fromClaudeCodePermissionRequest(input, options);
}

function parseArguments(argv: readonly string[]): Arguments {
  let adapter: Adapter | undefined;
  let configPath: string | undefined;
  let statusFile: string | undefined;
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[index + 1];
    if ((flag === "--adapter" || flag === "--config" || flag === "--status-file") && value === undefined) {
      throw new TypeError(`${flag} requires a value`);
    }
    if (flag === "--adapter") {
      if (value !== "normalized" && value !== "codex-permission" && value !== "claude-permission") {
        throw new TypeError(`unsupported adapter: ${value}`);
      }
      adapter = value;
      index += 1;
    } else if (flag === "--config") {
      configPath = value;
      index += 1;
    } else if (flag === "--status-file") {
      statusFile = value;
      index += 1;
    } else {
      throw new TypeError(`unknown argument: ${flag}`);
    }
  }
  if (adapter === undefined) throw new TypeError("--adapter is required");
  if (configPath === undefined) throw new TypeError("--config is required");
  return { adapter, configPath, ...(statusFile === undefined ? {} : { statusFile }) };
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

async function recordStatus(path: string, event: StatusEvent): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  try {
    await appendFile(`${path}.jsonl`, `${JSON.stringify(event)}\n`);
  } catch {
    // A journal failure must not suppress the existing aggregate or decision.
  }
  if (event.event === "started") return;
  let current: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(await readFile(path, "utf8")) as unknown;
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) current = parsed as Record<string, unknown>;
  } catch {
    // A missing or unreadable status file starts a new aggregate; it does not affect the decision.
  }
  const previousCounts = typeof current.counts === "object" && current.counts !== null && !Array.isArray(current.counts)
    ? current.counts as Record<string, unknown> : {};
  const reason = event.reason!;
  const previousCount = previousCounts[reason];
  const count = typeof previousCount === "number" && Number.isSafeInteger(previousCount) && previousCount >= 0
    ? previousCount : 0;
  const status = {
    schemaVersion: 1,
    counts: { ...previousCounts, [reason]: count + 1 },
    last: {
      ...event, scores: event.scores ?? {},
    },
  };
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, JSON.stringify(status));
  await rename(temporary, path);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`jev-agent-review: ${message}\n`);
  process.exitCode = 2;
});
