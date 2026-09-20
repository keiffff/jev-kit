import assert from "node:assert/strict";
import test from "node:test";

import { JevEvaluationError } from "@jev-kit/decision-contract";
import { defer, routeDecision, selectPath } from "../src/index.ts";

test("requires the caller to select or defer explicitly", async () => {
  const selected = await routeDecision({
    evaluate: async () => ({ aligned: 0.91 }),
    select: ({ aligned }) => aligned >= 0.7 ? selectPath("fast-path") : defer("below-policy-threshold"),
  });
  const deferred = await routeDecision({
    evaluate: async () => ({ aligned: 0.4 }),
    select: ({ aligned }) => aligned >= 0.7 ? selectPath("fast-path") : defer("below-policy-threshold"),
  });

  assert.equal(selected.status, "selected");
  if (selected.status === "selected") assert.equal(selected.path, "fast-path");
  assert.deepEqual(deferred, {
    status: "deferred",
    reason: "below-policy-threshold",
    response: { aligned: 0.4 },
  });
});

test("converts only evaluation failures to unavailable", async () => {
  const unavailable = await routeDecision({
    evaluate: async () => { throw new JevEvaluationError("connection", new Error("offline")); },
    select: () => selectPath("fast-path"),
  });
  assert.deepEqual(unavailable, {
    status: "deferred",
    reason: "unavailable",
    error: { kind: "connection", status: undefined },
  });

  await assert.rejects(routeDecision({
    evaluate: async () => { throw new TypeError("caller bug"); },
    select: () => selectPath("fast-path"),
  }), TypeError);
});
