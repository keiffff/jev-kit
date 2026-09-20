import assert from "node:assert/strict";
import test from "node:test";

import { JevClient } from "@jev-kit/decision-contract";
import { defineDiffContract, semanticDiff } from "../src/index.ts";

const usage = { input_tokens: 4, output_tokens: 2 };

test("returns exactly one score per versioned custom dimension", async () => {
  let sentState: unknown;
  const client = new JevClient({
    apiKey: "test-key",
    fetch: async (_input, init) => {
      const request = JSON.parse(String(init?.body));
      sentState = request.state;
      return Response.json({
        model: "jev-test",
        usage,
        answers: {
          meaning: { type: "noul", noul: 0.1 },
          runtime: { type: "noul", noul: 0.9 },
        },
      });
    },
  });
  const contract = defineDiffContract({
    id: "my-product.diff",
    version: "2026-09",
    dimensions: [
      { id: "meaning", instructions: "Did meaning change?" },
      { id: "runtime", instructions: "Did runtime behavior change?" },
    ] as const,
  });

  const result = await semanticDiff({ client, before: "old", after: "new", contract });

  assert.deepEqual(sentState, { before: "old", after: "new" });
  assert.deepEqual(result.scores, { meaning: 0.1, runtime: 0.9 });
  assert.equal(result.response.contract.id, "my-product.diff");
  assert.equal(result.response.contract.version, "2026-09");
  assert.match(result.response.contract.fingerprint, /^sha256:[a-f0-9]{64}$/);
});

test("rejects duplicate dimension ids before calling Jev", () => {
  assert.throws(() => defineDiffContract({
    id: "bad.diff",
    version: "1",
    dimensions: [
      { id: "meaning", instructions: "First" },
      { id: "meaning", instructions: "Second" },
    ],
  }), /duplicate diff dimension id/);
});
