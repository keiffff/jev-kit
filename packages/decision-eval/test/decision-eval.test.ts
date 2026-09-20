import assert from "node:assert/strict";
import test from "node:test";

import { evaluateThreshold, runBinaryFixtures } from "../src/index.ts";

test("reports errors by fixture instead of declaring a threshold good", () => {
  const result = evaluateThreshold([
    { id: "clear-positive", expected: true, observed: 0.9 },
    { id: "missed-positive", expected: true, observed: 0.4 },
    { id: "clear-negative", expected: false, observed: 0.1 },
    { id: "false-alarm", expected: false, observed: 0.8 },
  ], 0.7);

  assert.deepEqual(result.confusion, {
    truePositive: 1,
    trueNegative: 1,
    falsePositive: 1,
    falseNegative: 1,
  });
  assert.deepEqual(result.falsePositiveFixtureIds, ["false-alarm"]);
  assert.deepEqual(result.falseNegativeFixtureIds, ["missed-positive"]);
  assert.equal(result.accuracy, 0.5);
});

test("rejects invalid observations and duplicate fixture ids", () => {
  assert.throws(() => evaluateThreshold([{ id: "x", expected: true, observed: 2 }], 0.5));
  assert.throws(() => evaluateThreshold([
    { id: "x", expected: true, observed: 0.8 },
    { id: "x", expected: false, observed: 0.2 },
  ], 0.5));
});

test("runs reusable labeled states through a caller-owned observer", async () => {
  const seen: string[] = [];
  const result = await runBinaryFixtures({
    fixtures: [
      { id: "positive", state: { score: 0.9 }, expected: true },
      { id: "negative", state: { score: 0.2 }, expected: false },
    ],
    threshold: 0.7,
    observe: async (state, fixture) => {
      seen.push(fixture.id);
      return state.score;
    },
  });

  assert.deepEqual(seen, ["positive", "negative"]);
  assert.equal(result.accuracy, 1);
});
