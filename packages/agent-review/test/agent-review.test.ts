import assert from "node:assert/strict";
import test from "node:test";

import { JevClient } from "@jev-kit/decision-contract";
import {
  definePermissionReviewPolicy,
  evaluateAgentReviewFixtures,
  reviewAgentAction,
} from "../src/index.ts";
import type { AgentReviewRequest } from "../src/index.ts";

const policy = definePermissionReviewPolicy({
  id: "example.agent-permission",
  version: "1",
  thresholds: { policyCompliant: 0.7, instructionAligned: 0.7, highRisk: 0.15 },
});

const request: AgentReviewRequest = {
  schemaVersion: 1,
  agent: { name: "test-agent" },
  event: { name: "permission-request" },
  action: { tool: "Bash", input: { command: "pnpm test" }, description: "Run local tests" },
  context: { userMessages: ["テストして"], standingPolicy: "Allow requested local non-secret work." },
};

function clientWithAnswers(policyCompliant: number, instructionAligned: number, highRisk: number): JevClient {
  return new JevClient({
    apiKey: "test-key",
    fetch: async () => Response.json({
      model: "jev-test",
      usage: { input_tokens: 20, output_tokens: 3 },
      answers: {
        policy_compliant: { type: "noul", noul: policyCompliant },
        instruction_aligned: { type: "noul", noul: instructionAligned },
        high_risk: { type: "noul", noul: highRisk },
      },
    }),
  });
}

test("allows exactly at the caller-owned policy boundary", async () => {
  const result = await reviewAgentAction({
    client: clientWithAnswers(0.7, 0.7, 0.15), policy, request,
  });
  assert.equal(result.outcome, "allow");
  assert.equal(result.reason, "policy-allowed");
  assert.deepEqual(result.scores, {
    policyCompliant: 0.7, instructionAligned: 0.7, highRisk: 0.15,
  });
  assert.deepEqual(result.contract, { id: policy.id, version: policy.version });
});

test("defers below policy without losing the measured scores", async () => {
  const result = await reviewAgentAction({
    client: clientWithAnswers(0.69, 0.9, 0.01), policy, request,
  });
  assert.equal(result.outcome, "defer");
  assert.equal(result.reason, "policy-threshold-not-met");
  assert.equal(result.scores?.policyCompliant, 0.69);
});

test("does not send credential-like input to Jev", async () => {
  let calls = 0;
  const client = new JevClient({
    apiKey: "test-key",
    fetch: async () => {
      calls += 1;
      return Response.json({});
    },
  });
  const result = await reviewAgentAction({
    client,
    policy,
    request: { ...request, action: { tool: "Bash", input: { command: "cat /tmp/.env" } } },
  });
  assert.equal(result.reason, "sensitive-input");
  assert.equal(calls, 0);
});

test("checks the complete outbound request for sensitive values", async () => {
  let calls = 0;
  const client = new JevClient({
    apiKey: "test-key",
    fetch: async () => { calls += 1; return Response.json({}); },
  });
  const result = await reviewAgentAction({
    client,
    policy,
    request: {
      ...request,
      context: { ...request.context, standingPolicy: "Authorization: Bearer abcdefghijklmnop" },
    },
  });
  assert.equal(result.reason, "sensitive-input");
  assert.equal(calls, 0);
});

test("detects secrets stored under structured credential keys", async () => {
  let calls = 0;
  const client = new JevClient({
    apiKey: "test-key",
    fetch: async () => { calls += 1; return Response.json({}); },
  });
  const passwordResult = await reviewAgentAction({
    client,
    policy,
    request: { ...request, action: { tool: "HTTP", input: { password: "abcdefghijk" } } },
  });
  const nestedApiKeyResult = await reviewAgentAction({
    client,
    policy,
    request: { ...request, action: { tool: "HTTP", input: { auth: { apiKey: "not-sent-to-jev" } } } },
  });

  assert.equal(passwordResult.reason, "sensitive-input");
  assert.equal(nestedApiKeyResult.reason, "sensitive-input");
  assert.equal(calls, 0);
});

test("does not treat short lexical token fields or prose about passwords as credentials", async () => {
  const result = await reviewAgentAction({
    client: clientWithAnswers(0.9, 0.9, 0.01),
    policy,
    request: {
      ...request,
      action: {
        tool: "Editor",
        input: { token: "identifier", text: "Document the password field without including a value." },
      },
    },
  });
  assert.equal(result.outcome, "allow");
});

test("defers before network when no actual user context is available", async () => {
  let calls = 0;
  const client = new JevClient({
    apiKey: "test-key",
    fetch: async () => { calls += 1; return Response.json({}); },
  });
  const result = await reviewAgentAction({
    client,
    policy,
    request: { ...request, context: { ...request.context, userMessages: [] } },
  });
  assert.equal(result.reason, "context-unavailable");
  assert.equal(calls, 0);
});

test("turns provider failure into defer rather than allow or deny", async () => {
  const client = new JevClient({
    apiKey: "test-key",
    fetch: async () => { throw new Error("offline"); },
  });
  const result = await reviewAgentAction({ client, policy, request });
  assert.equal(result.outcome, "defer");
  assert.equal(result.reason, "provider-unavailable");
  assert.equal(result.errorKind, "connection");
});

test("rejects runtime input that does not match the published request schema", async () => {
  await assert.rejects(reviewAgentAction({
    client: clientWithAnswers(1, 1, 0),
    policy,
    request: {
      ...request,
      action: { tool: "Bash", input: { value: Number.NaN } },
    },
  }), /finite numbers/);
  await assert.rejects(reviewAgentAction({
    client: clientWithAnswers(1, 1, 0),
    policy,
    request: { ...request, unexpected: true } as AgentReviewRequest,
  }), /unsupported fields/);
});

test("evaluates labeled permission fixtures and identifies false allows and false defers", async () => {
  const result = await evaluateAgentReviewFixtures({
    client: clientWithAnswers(0.9, 0.9, 0.01),
    policy,
    fixtures: [
      { id: "expected-allow", request, expected: "allow" },
      { id: "false-allow", request: { ...request, requestId: "different-case" }, expected: "defer" },
    ],
  });

  assert.equal(result.total, 2);
  assert.equal(result.correct, 1);
  assert.equal(result.accuracy, 0.5);
  assert.deepEqual(result.falseAllowFixtureIds, ["false-allow"]);
  assert.deepEqual(result.falseDeferFixtureIds, []);
  assert.equal(result.providerCalls, 2);
  assert.deepEqual(result.usage, { inputTokens: 40, outputTokens: 6 });
  assert.equal(result.results[0]?.reason, "policy-allowed");
});

test("rejects duplicate permission fixture ids before the duplicate is evaluated", async () => {
  await assert.rejects(evaluateAgentReviewFixtures({
    client: clientWithAnswers(0.9, 0.9, 0.01),
    policy,
    fixtures: [
      { id: "duplicate", request, expected: "allow" },
      { id: "duplicate", request, expected: "allow" },
    ],
  }), /duplicate fixture id/);
});
