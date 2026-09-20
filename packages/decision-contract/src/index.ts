import {
  APIConnectionError,
  APIError,
  APITimeoutError,
  APIUserAbortError,
  TypeSafeClient,
  TypeSafeError,
} from "@typesafe-ai/sdk";
import type {
  EntryType,
  Question,
  Questions,
  RequestOptions,
  ResultFor,
  SystemOneResult,
  TypeSafeClientConfig,
} from "@typesafe-ai/sdk";

export { choice, noul, score } from "@typesafe-ai/sdk";
export type {
  ChoiceQuestion, ChoiceResponse, EntryType, JsonValue, NoulQuestion, NoulResponse,
  Question, Questions, RequestOptions, ResultFor, ScoreQuestion, ScoreResponse,
  SystemOneResult, TypeSafeClientConfig, Usage,
} from "@typesafe-ai/sdk";

export interface DecisionContract<Id extends string = string, Version extends string = string, Q extends Questions = Questions> {
  readonly id: Id;
  readonly version: Version;
  readonly questions: Q;
}

export type AnswersFor<Q extends Questions> = { readonly [K in keyof Q]: ResultFor<Q[K]> };

export interface DecisionResult<C extends DecisionContract> {
  readonly contract: { readonly id: C["id"]; readonly version: C["version"] };
  readonly model: string;
  readonly answers: AnswersFor<C["questions"]>;
  readonly usage: SystemOneResult<C["questions"]>["usage"];
}

export class InvalidDecisionContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidDecisionContractError";
  }
}

export class InvalidDecisionResponseError extends Error {
  readonly path: string;
  constructor(path: string, message: string) {
    super(`${path}: ${message}`);
    this.name = "InvalidDecisionResponseError";
    this.path = path;
  }
}

export type JevEvaluationErrorKind = "api" | "connection" | "timeout" | "aborted" | "invalid-response";

export class JevEvaluationError extends Error {
  readonly kind: JevEvaluationErrorKind;
  readonly status?: number;
  constructor(kind: JevEvaluationErrorKind, cause: unknown, status?: number) {
    super(cause instanceof Error ? cause.message : "Jev evaluation failed", { cause });
    this.name = "JevEvaluationError";
    this.kind = kind;
    this.status = status;
  }
}

export function defineContract<const Id extends string, const Version extends string, const Q extends Questions>(
  contract: DecisionContract<Id, Version, Q>,
): DecisionContract<Id, Version, Q> {
  if (contract.id.trim() === "") throw new InvalidDecisionContractError("contract id must not be empty");
  if (contract.version.trim() === "") throw new InvalidDecisionContractError("contract version must not be empty");
  if (Object.keys(contract.questions).length === 0) {
    throw new InvalidDecisionContractError("contract must contain at least one question");
  }
  return Object.freeze({
    id: contract.id,
    version: contract.version,
    questions: Object.freeze({ ...contract.questions }) as Q,
  });
}

export interface SystemOneClient {
  systemOne<const Q extends Questions>(
    request: { state: EntryType; questions: Q; model?: string },
    options?: RequestOptions,
  ): Promise<SystemOneResult<Q>>;
}

export interface JevClientConfig extends Omit<TypeSafeClientConfig, "retry"> {
  /** An SDK-compatible client can be injected for deterministic tests. */
  client?: SystemOneClient;
}

export interface EvaluateContractInput<C extends DecisionContract> {
  contract: C;
  state: EntryType;
  model?: string;
  signal?: AbortSignal;
}

/** Runs versioned contracts through the official SDK. One call means one model attempt. */
export class JevClient {
  readonly #client: SystemOneClient;

  constructor(config: JevClientConfig = {}) {
    const { client, ...sdkConfig } = config;
    this.#client = client ?? new TypeSafeClient({ ...sdkConfig, retry: { maxRetries: 0 } });
  }

  async evaluate<C extends DecisionContract>(input: EvaluateContractInput<C>): Promise<DecisionResult<C>> {
    let result: SystemOneResult<C["questions"]>;
    try {
      result = await this.#client.systemOne(
        {
          state: input.state,
          questions: input.contract.questions,
          ...(input.model === undefined ? {} : { model: input.model }),
        },
        {
          retry: { maxRetries: 0 },
          ...(input.signal === undefined ? {} : { signal: input.signal }),
        },
      );
      validateResult(input.contract.questions, result);
    } catch (error) {
      throw normalizeEvaluationError(error);
    }
    return {
      contract: { id: input.contract.id, version: input.contract.version },
      model: result.model,
      answers: result.answers,
      usage: result.usage,
    };
  }
}

function normalizeEvaluationError(error: unknown): JevEvaluationError {
  if (error instanceof JevEvaluationError) return error;
  if (error instanceof InvalidDecisionResponseError) return new JevEvaluationError("invalid-response", error);
  if (error instanceof APIUserAbortError) return new JevEvaluationError("aborted", error);
  if (error instanceof APITimeoutError) return new JevEvaluationError("timeout", error);
  if (error instanceof APIConnectionError) return new JevEvaluationError("connection", error);
  if (error instanceof APIError) return new JevEvaluationError("api", error, error.status);
  if (error instanceof TypeSafeError) return new JevEvaluationError("api", error);
  throw error;
}

function validateResult<Q extends Questions>(questions: Q, result: unknown): asserts result is SystemOneResult<Q> {
  assertRecord(result, "response");
  if (typeof result.model !== "string" || result.model.trim() === "") invalid("response.model", "must be a nonempty string");
  assertRecord(result.answers, "response.answers");
  assertExactKeys(result.answers, Object.keys(questions), "response.answers");
  assertRecord(result.usage, "response.usage");
  assertNonnegativeInteger(result.usage.input_tokens, "response.usage.input_tokens");
  assertNonnegativeInteger(result.usage.output_tokens, "response.usage.output_tokens");
  for (const [name, question] of Object.entries(questions)) {
    validateAnswer(question, result.answers[name], `response.answers.${name}`);
  }
}

function validateAnswer(question: Question, answer: unknown, path: string): void {
  assertRecord(answer, path);
  if (answer.type !== question.type) invalid(`${path}.type`, `must equal ${question.type}`);
  if (question.type === "noul") {
    assertProbability(answer.noul, `${path}.noul`);
    return;
  }
  assertProbability(answer.confidence, `${path}.confidence`);
  assertRecord(answer.probabilities, `${path}.probabilities`);
  if (question.type === "choice") {
    const labels = Object.keys(question.criteria);
    assertExactKeys(answer.probabilities, labels, `${path}.probabilities`);
    for (const label of labels) assertProbability(answer.probabilities[label], `${path}.probabilities.${label}`);
    if (typeof answer.choice !== "string" || !Object.hasOwn(question.criteria, answer.choice)) {
      invalid(`${path}.choice`, "must be one of the contract criteria");
    }
    return;
  }
  const scoreKeys = question.criteria.map((_, index) => String(index));
  assertExactKeys(answer.probabilities, scoreKeys, `${path}.probabilities`);
  for (const key of scoreKeys) assertProbability(answer.probabilities[key], `${path}.probabilities.${key}`);
  if (typeof answer.score !== "number" || !Number.isFinite(answer.score)
    || answer.score < 0 || answer.score > question.criteria.length - 1) {
    invalid(`${path}.score`, `must be finite and between 0 and ${question.criteria.length - 1}`);
  }
  assertRecord(answer.legend, `${path}.legend`);
  assertExactKeys(answer.legend, scoreKeys, `${path}.legend`);
  for (const [index, expected] of question.criteria.entries()) {
    if (!jsonEqual(answer.legend[String(index)], expected)) {
      invalid(`${path}.legend.${index}`, "must match the contract criterion");
    }
  }
}

function assertRecord(value: unknown, path: string): asserts value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) invalid(path, "must be an object");
}

function assertExactKeys(value: Record<string, unknown>, expected: readonly string[], path: string): void {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    invalid(path, `must contain exactly: ${wanted.join(", ")}`);
  }
}

function assertProbability(value: unknown, path: string): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
    invalid(path, "must be a finite number from 0 to 1");
  }
}

function assertNonnegativeInteger(value: unknown, path: string): asserts value is number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) invalid(path, "must be a nonnegative integer");
}

function jsonEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right)
      && left.length === right.length
      && left.every((value, index) => jsonEqual(value, right[index]));
  }
  if (typeof left === "object" && left !== null && typeof right === "object" && right !== null) {
    const leftRecord = left as Record<string, unknown>;
    const rightRecord = right as Record<string, unknown>;
    const leftKeys = Object.keys(leftRecord).sort();
    const rightKeys = Object.keys(rightRecord).sort();
    return leftKeys.length === rightKeys.length
      && leftKeys.every((key, index) => key === rightKeys[index] && jsonEqual(leftRecord[key], rightRecord[key]));
  }
  return false;
}

function invalid(path: string, message: string): never {
  throw new InvalidDecisionResponseError(path, message);
}
