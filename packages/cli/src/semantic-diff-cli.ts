#!/usr/bin/env node
import { JevClient, JevEvaluationError } from "@jev-kit/decision-contract";
import { defineDiffContract, semanticDiff } from "@jev-kit/semantic-diff";
import { parseSemanticDiffInput } from "./index.js";

async function main(): Promise<void> {
  const input = parseSemanticDiffInput(JSON.parse(await readStdin()) as unknown);
  const client = new JevClient({
    ...(input.model === undefined ? {} : { defaultModel: input.model }),
    ...(input.longContext ? { defaultHeaders: { "TypeSafe-Danger-Zone-Long-Context": "true" } } : {}),
  });
  const contract = input.contract === undefined ? undefined : defineDiffContract(input.contract);
  const result = await semanticDiff({
    client,
    before: input.before,
    after: input.after,
    ...(contract === undefined ? {} : { contract }),
  });
  process.stdout.write(`${JSON.stringify({
    schemaVersion: 1,
    status: "evaluated",
    contract: result.response.contract,
    scores: result.scores,
    model: result.response.model,
    usage: result.response.usage,
  })}\n`);
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  const text = Buffer.concat(chunks).toString("utf8");
  if (text.trim() === "") throw new TypeError("stdin must contain one JSON document");
  return text;
}

main().catch((error: unknown) => {
  if (error instanceof JevEvaluationError) {
    const errorType = apiErrorType(error.cause);
    process.stdout.write(`${JSON.stringify({
      schemaVersion: 1,
      status: "unavailable",
      errorKind: error.kind,
      ...(error.status === undefined ? {} : { httpStatus: error.status }),
      ...(errorType === undefined ? {} : { errorType }),
    })}\n`);
    return;
  }
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`jev-kit-semantic-diff: ${message}\n`);
  process.exitCode = 2;
});

/** Keep the machine-readable API code, never its message, headers or request body. */
function apiErrorType(cause: unknown): string | undefined {
  if (typeof cause !== "object" || cause === null || !("body" in cause)) return;
  const body = cause.body;
  if (typeof body !== "object" || body === null || !("detail" in body)) return;
  const detail = body.detail;
  if (typeof detail !== "object" || detail === null || !("error_type" in detail)) return;
  return typeof detail.error_type === "string" && /^[a-z][a-z0-9_]*$/.test(detail.error_type)
    ? detail.error_type : undefined;
}
