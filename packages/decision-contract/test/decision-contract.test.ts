import assert from "node:assert/strict";
import test from "node:test";

import {
  InvalidDecisionContractError,
  JevClient,
  JevEvaluationError,
  assertContractVersioning,
  choice,
  defineContract,
  noul,
  score,
} from "../src/index.ts";

const usage = { input_tokens: 10, output_tokens: 3 };

test("runs a versioned mixed contract through the official SDK", async () => {
  let requestBody: Record<string, unknown> | undefined;
  const client = new JevClient({
    apiKey: "test-key",
    fetch: async (_input, init) => {
      requestBody = JSON.parse(String(init?.body));
      return Response.json({
        model: "jev-test",
        usage,
        answers: {
          safe: { type: "noul", noul: 0.92 },
          route: {
            type: "choice", choice: "fast", confidence: 0.8,
            probabilities: { fast: 0.9, defer: 0.1 },
          },
          severity: {
            type: "score", score: 0.2, confidence: 0.9,
            probabilities: { "0": 0.8, "1": 0.2 },
            legend: { "0": "low", "1": "high" },
          },
        },
      });
    },
  });
  const contract = defineContract({
    id: "example.routing",
    version: "1",
    questions: {
      safe: noul("Is the action safe?"),
      route: choice("Which route?", { fast: "Direct", defer: "Existing review" }),
      severity: score("How severe?", ["low", "high"]),
    },
  });

  const result = await client.evaluate({ contract, state: { action: "read" } });

  assert.equal(result.contract.id, "example.routing");
  assert.equal(result.contract.version, "1");
  assert.match(result.contract.fingerprint, /^sha256:[a-f0-9]{64}$/);
  assert.equal(requestBody?.model, "jev-latest");
  assert.equal(result.answers.route.choice, "fast");
  assert.equal(result.answers.severity.score, 0.2);
});

test("fingerprints contract semantics independently of object key order", () => {
  const first = defineContract({
    id: "example.fingerprint",
    version: "1",
    questions: { safe: noul("Safe?"), aligned: noul("Aligned?") },
  });
  const reordered = defineContract({
    id: "example.fingerprint",
    version: "1",
    questions: { aligned: noul("Aligned?"), safe: noul("Safe?") },
  });
  const changed = defineContract({
    id: "example.fingerprint",
    version: "1",
    questions: { safe: noul("Still safe?"), aligned: noul("Aligned?") },
  });

  assert.equal(first.fingerprint, reordered.fingerprint);
  assert.notEqual(first.fingerprint, changed.fingerprint);
  assert.throws(
    () => assertContractVersioning(first, changed),
    (error: unknown) => error instanceof InvalidDecisionContractError
      && /changed without a version change/.test(error.message),
  );
});

test("clones and freezes nested question semantics before fingerprinting", () => {
  const criteria = { allow: "Allowed", defer: "Deferred" };
  const contract = defineContract({
    id: "example.immutable",
    version: "1",
    questions: { route: choice("Route?", criteria) },
  });
  const fingerprint = contract.fingerprint;

  criteria.allow = "Changed outside the contract";

  assert.equal(contract.questions.route.criteria.allow, "Allowed");
  assert.equal(contract.fingerprint, fingerprint);
  assert.equal(Object.isFrozen(contract.questions.route.criteria), true);
});

test("rejects missing, extra and out-of-range answers at runtime", async () => {
  const contract = defineContract({
    id: "example.validated",
    version: "1",
    questions: { safe: noul("Safe?"), route: choice("Route?", { yes: null, no: null }) },
  });
  const client = new JevClient({
    apiKey: "test-key",
    fetch: async () => Response.json({
      model: "jev-test",
      usage,
      answers: {
        safe: { type: "noul", noul: 1.2 },
        unexpected: { type: "noul", noul: 0.2 },
      },
    }),
  });

  await assert.rejects(
    client.evaluate({ contract, state: "value" }),
    (error: unknown) => error instanceof JevEvaluationError && error.kind === "invalid-response",
  );
});

test("does not retry an API failure", async () => {
  let calls = 0;
  const client = new JevClient({
    apiKey: "test-key",
    fetch: async () => {
      calls += 1;
      return new Response("busy", { status: 503 });
    },
  });
  const contract = defineContract({ id: "example.once", version: "1", questions: { valid: noul("Valid?") } });

  await assert.rejects(
    client.evaluate({ contract, state: "value" }),
    (error: unknown) => error instanceof JevEvaluationError && error.kind === "api" && error.status === 503,
  );
  assert.equal(calls, 1);
});
