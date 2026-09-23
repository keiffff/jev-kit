import assert from "node:assert/strict";
import test from "node:test";

import {
  compareDecisionPolicies,
  evaluateThreshold,
  runBinaryFixtures,
  summarizeScoreVariation,
} from "../src/index.ts";

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

test("compares caller-owned policies on calibration and holdout fixtures without selecting one", () => {
  const result = compareDecisionPolicies({
    calibrationFixtures: [
      { id: "routine-read", expected: true, observation: { aligned: 0.65, risk: 0.05 } },
      { id: "unrequested-write", expected: false, observation: { aligned: 0.3, risk: 0.8 } },
    ],
    holdoutFixtures: [
      { id: "routine-test", expected: true, observation: { aligned: 0.68, risk: 0.04 } },
      { id: "unrelated-target", expected: false, observation: { aligned: 0.2, risk: 0.4 } },
    ],
    candidates: [
      { id: "current", policy: { aligned: 0.7, risk: 0.15 } },
      { id: "candidate", policy: { aligned: 0.6, risk: 0.15 } },
    ],
    decide: (observation, policy) => observation.aligned >= policy.aligned && observation.risk <= policy.risk,
  });

  assert.deepEqual(result.candidates.map((candidate) => candidate.id), ["current", "candidate"]);
  assert.equal(result.candidates[0]?.calibration.selectionRate, 0);
  assert.deepEqual(result.candidates[0]?.calibration.falseDeferFixtureIds, ["routine-read"]);
  assert.equal(result.candidates[1]?.calibration.selectionRate, 0.5);
  assert.equal(result.candidates[1]?.holdout.accuracy, 1);
  assert.deepEqual(result.candidates[1]?.holdout.falseAllowFixtureIds, []);
  assert.deepEqual(result.candidates[1]?.holdout.results[0], {
    id: "routine-test",
    expected: true,
    selected: true,
    correct: true,
    observation: { aligned: 0.68, risk: 0.04 },
  });
});

test("reports false allows and rejects duplicate fixture or candidate ids", () => {
  const compare = (overrides = {}) => compareDecisionPolicies({
    calibrationFixtures: [{ id: "unsafe", expected: false, observation: 0.8 }],
    holdoutFixtures: [],
    candidates: [{ id: "candidate", policy: 0.7 }],
    decide: (observation: number, threshold: number) => observation >= threshold,
    ...overrides,
  });

  assert.deepEqual(compare().candidates[0]?.calibration.falseAllowFixtureIds, ["unsafe"]);
  assert.throws(() => compare({
    candidates: [{ id: "same", policy: 0.7 }, { id: "same", policy: 0.8 }],
  }), /duplicate candidate id/);
  assert.throws(() => compare({
    calibrationFixtures: [
      { id: "same", expected: true, observation: 0.8 },
      { id: "same", expected: false, observation: 0.2 },
    ],
  }), /duplicate calibration fixture id/);
});

test("summarizes score variation across repeated runs", () => {
  const result = summarizeScoreVariation([
    { fixtureId: "local-test", runId: "run-1", scores: { aligned: 0.68, risk: 0.04 } },
    { fixtureId: "local-test", runId: "run-2", scores: { aligned: 0.54, risk: 0.05 } },
  ]);

  assert.deepEqual(result, [{
    fixtureId: "local-test",
    runIds: ["run-1", "run-2"],
    dimensions: {
      aligned: { minimum: 0.54, maximum: 0.68, spread: 0.14 },
      risk: { minimum: 0.04, maximum: 0.05, spread: 0.010000000000000002 },
    },
  }]);
  assert.throws(() => summarizeScoreVariation([
    { fixtureId: "x", runId: "one", scores: { aligned: 0.5 } },
    { fixtureId: "x", runId: "two", scores: { risk: 0.5 } },
  ]), /inconsistent score dimensions/);
});
