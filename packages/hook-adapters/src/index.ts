import { readFile } from "node:fs/promises";
import type { AgentReviewRequest, AgentReviewResult, JsonValue } from "@jev-kit/agent-review";

export interface PermissionHookAdapterOptions {
  readonly standingPolicy: string;
  readonly userMessages?: readonly string[];
  readonly userMessageCount?: number;
}

export async function fromCodexPermissionRequest(
  input: unknown,
  options: PermissionHookAdapterOptions,
): Promise<AgentReviewRequest> {
  return fromPermissionHook("codex", input, options);
}

export async function fromClaudeCodePermissionRequest(
  input: unknown,
  options: PermissionHookAdapterOptions,
): Promise<AgentReviewRequest> {
  return fromPermissionHook("claude-code", input, options);
}

export function renderPermissionHookResult(result: AgentReviewResult): object | undefined {
  if (result.outcome !== "allow") return undefined;
  return {
    hookSpecificOutput: {
      hookEventName: "PermissionRequest",
      decision: { behavior: "allow" },
    },
  };
}

export function extractLatestUserMessages(transcript: string, limit?: number): string[] {
  if (limit !== undefined && (!Number.isInteger(limit) || limit < 1)) {
    throw new TypeError("user message count must be a positive integer");
  }
  const messages: string[] = [];
  for (const line of transcript.split(/\r?\n/)) {
    if (line.trim() === "") continue;
    try {
      const entry = JSON.parse(line) as unknown;
      const message = extractUserMessage(entry);
      if (message !== undefined && isActualUserMessage(message)) messages.push(message);
    } catch {
      continue;
    }
  }
  return limit === undefined ? messages : messages.slice(-limit);
}

export async function readLatestUserMessages(path: string, limit?: number): Promise<string[]> {
  if (path.trim() === "") return [];
  try {
    return extractLatestUserMessages(await readFile(path, "utf8"), limit);
  } catch {
    return [];
  }
}

async function fromPermissionHook(
  agentName: string,
  input: unknown,
  options: PermissionHookAdapterOptions,
): Promise<AgentReviewRequest> {
  const hook = record(input, "hook input");
  const toolName = nonempty(hook.tool_name, "hook input.tool_name");
  if (!Object.hasOwn(hook, "tool_input")) throw new TypeError("hook input.tool_input is required");
  const toolInput = hook.tool_input;
  assertJsonValue(toolInput, "hook input.tool_input");
  const transcriptPath = typeof hook.transcript_path === "string" ? hook.transcript_path : "";
  const userMessages = options.userMessages === undefined
    ? await readLatestUserMessages(transcriptPath, options.userMessageCount)
    : [...options.userMessages];
  const description = typeof toolInput === "object" && toolInput !== null && !Array.isArray(toolInput)
    ? stringField(toolInput, "description") ?? stringField(toolInput, "justification")
    : undefined;
  return {
    schemaVersion: 1,
    ...(typeof hook.session_id === "string" && hook.session_id !== "" ? { requestId: hook.session_id } : {}),
    agent: { name: agentName },
    event: { name: "permission-request" },
    action: { tool: toolName, input: toolInput, ...(description === undefined ? {} : { description }) },
    context: {
      userMessages,
      standingPolicy: nonempty(options.standingPolicy, "standing policy"),
      ...(typeof hook.cwd === "string" ? { cwd: hook.cwd } : {}),
    },
  };
}

const SYNTHETIC_PREFIXES = [
  "# AGENTS.md instructions", "<app-context>", "<skills_instructions>",
  "<permissions instructions>", "<environment_context>", "The following is the Codex agent history",
];

function isActualUserMessage(text: string): boolean {
  const stripped = text.trimStart();
  return stripped !== "" && !SYNTHETIC_PREFIXES.some((prefix) => stripped.startsWith(prefix));
}

function extractUserMessage(value: unknown): string | undefined {
  const entry = maybeRecord(value);
  if (entry === undefined) return undefined;
  const payload = maybeRecord(entry.payload);
  if (entry.type === "response_item" && payload?.type === "message" && payload.role === "user") {
    return contentText(payload.content);
  }
  const message = maybeRecord(entry.message);
  if (entry.type === "user" && message?.role === "user") return contentText(message.content);
  if (entry.role === "user") return contentText(entry.content);
  return undefined;
}

function contentText(value: unknown): string | undefined {
  if (typeof value === "string") return value.trim();
  if (!Array.isArray(value)) return undefined;
  const parts = value.flatMap((part) => {
    const item = maybeRecord(part);
    if (item === undefined) return [];
    const text = typeof item.text === "string" ? item.text : typeof item.content === "string" ? item.content : undefined;
    return text === undefined ? [] : [text];
  });
  return parts.join("\n").trim();
}

function assertJsonValue(value: unknown, path: string): asserts value is JsonValue {
  try {
    const encoded = JSON.stringify(value);
    if (encoded === undefined) throw new TypeError();
  } catch {
    throw new TypeError(`${path} must be JSON-compatible`);
  }
}

function record(value: unknown, path: string): Record<string, unknown> {
  const result = maybeRecord(value);
  if (result === undefined) throw new TypeError(`${path} must be an object`);
  return result;
}

function maybeRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown> : undefined;
}

function nonempty(value: unknown, path: string): string {
  if (typeof value !== "string" || value.trim() === "") throw new TypeError(`${path} must be a nonempty string`);
  return value;
}

function stringField(value: object, field: string): string | undefined {
  const candidate = (value as Record<string, unknown>)[field];
  return typeof candidate === "string" ? candidate : undefined;
}
