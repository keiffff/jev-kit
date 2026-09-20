import assert from "node:assert/strict";
import test from "node:test";

import { JevClient } from "@jev-kit/decision-contract";
import { verifyClaim } from "../src/index.ts";

test("returns independent evidence axes without deciding the claim", async () => {
  const client = new JevClient({
    apiKey: "test-key",
    fetch: async () => Response.json({
      model: "jev-test",
      usage: { input_tokens: 8, output_tokens: 4 },
      answers: {
        direct_support: { type: "noul", noul: 0.84 },
        specificity_supported: { type: "noul", noul: 0.62 },
        contradicted: { type: "noul", noul: 0.03 },
        alternatives_remain: { type: "noul", noul: 0.41 },
      },
    }),
  });

  const result = await verifyClaim({
    client,
    evidence: "The request returned HTTP 429.",
    claim: "The immediate stopping layer was an API quota response.",
  });

  assert.deepEqual(result.scores, {
    direct_support: 0.84,
    specificity_supported: 0.62,
    contradicted: 0.03,
    alternatives_remain: 0.41,
  });
  assert.equal("decision" in result, false);
});
