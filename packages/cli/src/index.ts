import type { EntryType } from "@jev-kit/decision-contract";

export interface AgentReviewCliConfig {
  readonly schemaVersion: 1;
  readonly policy: {
    readonly id: string;
    readonly version: string;
    readonly thresholds: {
      readonly policyCompliant: number;
      readonly instructionAligned: number;
      readonly highRisk: number;
    };
    readonly questions?: {
      readonly policyCompliant?: string;
      readonly instructionAligned?: string;
      readonly highRisk?: string;
    };
  };
  readonly standingPolicy: string;
  readonly userMessageCount?: number;
  readonly model?: string;
}

export interface EvidenceCheckCliInput {
  readonly schemaVersion: 1;
  readonly evidence: EntryType;
  readonly claim: EntryType;
  readonly contract?: {
    readonly id: string;
    readonly version: string;
    readonly axes: readonly { readonly id: string; readonly instructions: string }[];
  };
  readonly model?: string;
}

export interface SemanticDiffCliInput {
  readonly schemaVersion: 1;
  readonly before: EntryType;
  readonly after: EntryType;
  readonly contract?: {
    readonly id: string;
    readonly version: string;
    readonly dimensions: readonly { readonly id: string; readonly instructions: string }[];
  };
  readonly model?: string;
}

export function parseCliConfig(value: unknown): AgentReviewCliConfig {
  const config = record(value, "config");
  if (config.schemaVersion !== 1) throw new TypeError("config.schemaVersion must equal 1");
  const policy = record(config.policy, "config.policy");
  nonempty(policy.id, "config.policy.id");
  nonempty(policy.version, "config.policy.version");
  const thresholds = record(policy.thresholds, "config.policy.thresholds");
  for (const name of ["policyCompliant", "instructionAligned", "highRisk"] as const) {
    probability(thresholds[name], `config.policy.thresholds.${name}`);
  }
  nonempty(config.standingPolicy, "config.standingPolicy");
  if (config.userMessageCount !== undefined
    && (!Number.isInteger(config.userMessageCount) || (config.userMessageCount as number) < 1)) {
    throw new TypeError("config.userMessageCount must be a positive integer");
  }
  if (config.model !== undefined) nonempty(config.model, "config.model");
  return value as AgentReviewCliConfig;
}

export function parseEvidenceCheckInput(value: unknown): EvidenceCheckCliInput {
  const input = record(value, "input");
  schemaVersion(input.schemaVersion);
  if (!("evidence" in input)) throw new TypeError("input.evidence is required");
  if (!("claim" in input)) throw new TypeError("input.claim is required");
  entryValue(input.evidence, "input.evidence");
  entryValue(input.claim, "input.claim");
  if (input.contract !== undefined) parseNamedItemsContract(input.contract, "axes", "input.contract");
  if (input.model !== undefined) nonempty(input.model, "input.model");
  return value as EvidenceCheckCliInput;
}

export function parseSemanticDiffInput(value: unknown): SemanticDiffCliInput {
  const input = record(value, "input");
  schemaVersion(input.schemaVersion);
  if (!("before" in input)) throw new TypeError("input.before is required");
  if (!("after" in input)) throw new TypeError("input.after is required");
  entryValue(input.before, "input.before");
  entryValue(input.after, "input.after");
  if (input.contract !== undefined) parseNamedItemsContract(input.contract, "dimensions", "input.contract");
  if (input.model !== undefined) nonempty(input.model, "input.model");
  return value as SemanticDiffCliInput;
}

function parseNamedItemsContract(value: unknown, itemKey: "axes" | "dimensions", path: string): void {
  const contract = record(value, path);
  nonempty(contract.id, `${path}.id`);
  nonempty(contract.version, `${path}.version`);
  const items = contract[itemKey];
  if (!Array.isArray(items) || items.length === 0) throw new TypeError(`${path}.${itemKey} must be a nonempty array`);
  for (const [index, item] of items.entries()) {
    const entry = record(item, `${path}.${itemKey}[${index}]`);
    nonempty(entry.id, `${path}.${itemKey}[${index}].id`);
    nonempty(entry.instructions, `${path}.${itemKey}[${index}].instructions`);
  }
}

function schemaVersion(value: unknown): asserts value is 1 {
  if (value !== 1) throw new TypeError("input.schemaVersion must equal 1");
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new TypeError(`${path} must be an object`);
  return value as Record<string, unknown>;
}

function entryValue(value: unknown, path: string): asserts value is EntryType {
  if (typeof value === "number" || typeof value === "boolean" || value === undefined) {
    throw new TypeError(`${path} must be text, an object, an array, or null`);
  }
  jsonValue(value, path, new Set());
}

function jsonValue(value: unknown, path: string, seen: Set<object>): void {
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError(`${path} must contain only finite numbers`);
    return;
  }
  if (typeof value !== "object") throw new TypeError(`${path} must be JSON-compatible`);
  if (seen.has(value)) throw new TypeError(`${path} must not contain cycles`);
  seen.add(value);
  if (Array.isArray(value)) {
    value.forEach((item, index) => jsonValue(item, `${path}[${index}]`, seen));
  } else {
    for (const [key, item] of Object.entries(value)) jsonValue(item, `${path}.${key}`, seen);
  }
  seen.delete(value);
}

function nonempty(value: unknown, path: string): asserts value is string {
  if (typeof value !== "string" || value.trim() === "") throw new TypeError(`${path} must be a nonempty string`);
}

function probability(value: unknown, path: string): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new TypeError(`${path} must be a finite number from 0 to 1`);
  }
}
