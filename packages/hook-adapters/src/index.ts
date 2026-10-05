import { readFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
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
  let conversation: Pick<AgentReviewRequest["context"], "userMessages" | "previousUserMessages" | "assistantMessages" | "relatedAction">;
  if (options.userMessages !== undefined) {
    conversation = { userMessages: [...options.userMessages] };
  } else {
    let transcript = "";
    if (transcriptPath !== "") {
      try { transcript = await readFile(transcriptPath, "utf8"); } catch { /* Same unavailable-context behavior as readLatestUserMessages. */ }
    }
    conversation = permissionConversation(transcript, options.userMessageCount, toolName, toolInput);
  }
  const actionSources = await readActionSources(toolName, toolInput, typeof hook.cwd === "string" ? hook.cwd : undefined);
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
      ...conversation,
      ...(actionSources.length === 0 ? {} : { actionSources }),
      standingPolicy: nonempty(options.standingPolicy, "standing policy"),
      ...(typeof hook.cwd === "string" ? { cwd: hook.cwd } : {}),
    },
  };
}

const SYNTHETIC_PREFIXES = [
  "# AGENTS.md instructions", "<app-context>", "<skills_instructions>",
  "<permissions instructions>", "<environment_context>", "The following is the Codex agent history",
  "<external_codex_apps_open_page>",
];

/** Retain historical constraints separately from current authorization and assistant explanations. */
function permissionConversation(transcript: string, limit: number | undefined, tool: string, input: JsonValue):
  Pick<AgentReviewRequest["context"], "userMessages" | "previousUserMessages" | "assistantMessages" | "relatedAction"> {
  const allUsers = extractLatestUserMessages(transcript);
  const userMessages = extractLatestUserMessages(transcript, limit);
  const previousUserMessages = allUsers.slice(0, allUsers.length - userMessages.length);
  const messages: { role: string; text: string }[] = [];
  let relatedAction: AgentReviewRequest["context"]["relatedAction"];
  const pendingCommands = new Map<string, string>();
  const requestedSession = maybeRecord(input)?.session_id;
  for (const line of transcript.split(/\r?\n/)) {
    let entry: Record<string, unknown> | undefined;
    try { entry = maybeRecord(JSON.parse(line)); } catch { continue; }
    if (entry === undefined) continue;
    const user = extractUserMessage(entry);
    if (user !== undefined && isActualUserMessage(user)) messages.push({ role: "user", text: user });
    const payload = maybeRecord(entry.payload);
    if (payload?.type === "custom_tool_call" && payload.name === "exec" && typeof payload.input === "string" && typeof payload.call_id === "string") {
      const commands = [...payload.input.matchAll(/\bcmd\s*:\s*("(?:\\.|[^"\\])*")/g)];
      if (commands.length === 1) {
        try { pendingCommands.set(payload.call_id, JSON.parse(commands[0][1]) as string); } catch { /* No inferred command for nonliteral inputs. */ }
      }
    }
    if (tool === "write_stdin" && requestedSession !== undefined && payload?.type === "custom_tool_call_output" && typeof payload.call_id === "string") {
      const command = pendingCommands.get(payload.call_id);
      const output = JSON.stringify(payload.output);
      const sessions = output === undefined ? [] : [...output.matchAll(/\bSESSION_ID=(\d+)|session_id\\*"?\s*:\s*(\d+)/g)].map((match) => match[1] ?? match[2]);
      if (command !== undefined && sessions.includes(String(requestedSession))) relatedAction = { tool: "Bash", input: { command } };
    }
    const message = entry.type === "response_item" ? payload : maybeRecord(entry.message) ?? entry;
    if (message?.role === "assistant" && message.channel !== "analysis") {
      const text = contentText(message.content);
      if (text) messages.push({ role: "assistant", text });
    }
    // Only the originating command is needed for terminal interruption; never include its stdout/stderr.
    const item = maybeRecord(payload?.item);
    if (tool === "write_stdin" && requestedSession !== undefined && payload?.type === "item_completed"
      && item?.process_id !== undefined && String(item.process_id) === String(requestedSession)
      && (typeof item.command === "string" || Array.isArray(item.command))) {
      relatedAction = { tool: "Bash", input: { command: item.command as JsonValue } };
    }
  }
  let latestUser = -1;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].role === "user") { latestUser = index; break; }
  }
  const beforeUser = messages.slice(0, latestUser).reverse().find((message) => message.role === "assistant");
  const afterUser = messages.slice(latestUser + 1).reverse().find((message) => message.role === "assistant");
  const assistantMessages = [beforeUser, afterUser].flatMap((message) => message === undefined ? [] : [message.text]);
  return {
    userMessages,
    ...(previousUserMessages.length === 0 ? {} : { previousUserMessages }),
    ...(assistantMessages.length === 0 ? {} : { assistantMessages }),
    ...(relatedAction === undefined ? {} : { relatedAction }),
  };
}

/** Read only a directly invoked script, not command output, imported files or credential stores. */
async function readActionSources(tool: string, input: JsonValue, cwd: string | undefined): Promise<NonNullable<AgentReviewRequest["context"]["actionSources"]>> {
  if (tool !== "Bash" && tool !== "exec_command") return [];
  const record = maybeRecord(input);
  const command = record?.command ?? record?.cmd;
  let shell: string | undefined;
  if (typeof command === "string") shell = command;
  else if (Array.isArray(command) && command.every((part) => typeof part === "string")) {
    const flag = command.findIndex((part) => part === "-c" || part === "-lc");
    if (flag >= 0) shell = command[flag + 1] as string | undefined;
  }
  if (shell === undefined) return [];
  const first = shell.trimStart().match(/^(?:"([^"]+)"|'([^']+)'|([^\s;&|<>]+))/);
  const path = first?.[1] ?? first?.[2] ?? first?.[3];
  if (path === undefined || !/\.(?:sh|zsh|bash|py|js|mjs|cjs)$/.test(path)) return [];
  if (!isAbsolute(path) && cwd === undefined) return [];
  const absolute = isAbsolute(path) ? path : resolve(cwd!, path);
  try { return [{ path: absolute, content: await readFile(absolute, "utf8") }]; }
  catch { return []; }
}

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
