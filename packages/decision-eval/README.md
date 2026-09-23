# @jev-kit/decision-eval

Measure false positives, false negatives, precision, recall, specificity and accuracy for caller-supplied thresholds and decision policies.

```ts
import { evaluateThreshold } from "@jev-kit/decision-eval";

const report = evaluateThreshold([
  { id: "allowed-read", expected: true, observed: 0.94 },
  { id: "blocked-write", expected: false, observed: 0.08 },
], 0.8);

console.log(report.falsePositiveFixtureIds);
```

The package reports threshold behavior; it does not choose or approve a threshold.

## Compare policy candidates

Use separate calibration and holdout fixtures to see whether a candidate only fits the cases used to design it. The caller owns the policy shape and the final `boolean` decision, so multi-score policies can be evaluated without moving control flow into this package.

`expected: true` means the policy should select the fast path, such as a direct allow. `false` means it should defer or choose the non-selected path.

```ts
import { compareDecisionPolicies } from "@jev-kit/decision-eval";

const comparison = compareDecisionPolicies({
  calibrationFixtures,
  holdoutFixtures,
  candidates: [
    { id: "current", policy: { aligned: 0.70, risk: 0.15 } },
    { id: "candidate", policy: { aligned: 0.60, risk: 0.15 } },
  ],
  decide: (scores, policy) => (
    scores.aligned >= policy.aligned && scores.risk <= policy.risk
  ),
});

for (const candidate of comparison.candidates) {
  console.log(candidate.id, candidate.calibration, candidate.holdout);
}
```

Each result includes the selection rate, selected-result precision, false-allow IDs, false-defer IDs and per-fixture observations. Model versions and scores can therefore stay in the caller-defined observation and remain attached when the comparison is serialized. Candidate order is preserved; no candidate is selected automatically and no runtime policy is changed.

Repeated live evaluations can also expose score drift for identical fixtures:

```ts
import { summarizeScoreVariation } from "@jev-kit/decision-eval";

const variation = summarizeScoreVariation([
  { fixtureId: "local-test", runId: "run-1", scores: { aligned: 0.68, risk: 0.04 } },
  { fixtureId: "local-test", runId: "run-2", scores: { aligned: 0.54, risk: 0.05 } },
]);
```

The summary reports the minimum, maximum and spread for each score. Model versions and raw fixture results remain caller-owned evidence.
