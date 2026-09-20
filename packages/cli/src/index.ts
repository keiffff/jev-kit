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

function record(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new TypeError(`${path} must be an object`);
  return value as Record<string, unknown>;
}

function nonempty(value: unknown, path: string): asserts value is string {
  if (typeof value !== "string" || value.trim() === "") throw new TypeError(`${path} must be a nonempty string`);
}

function probability(value: unknown, path: string): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new TypeError(`${path} must be a finite number from 0 to 1`);
  }
}
