# @jev-kit/decision-eval

Measure false positives, false negatives, precision, recall, specificity and accuracy for a caller-supplied threshold.

```ts
import { evaluateThreshold } from "@jev-kit/decision-eval";

const report = evaluateThreshold([
  { id: "allowed-read", expected: true, observed: 0.94 },
  { id: "blocked-write", expected: false, observed: 0.08 },
], 0.8);

console.log(report.falsePositiveFixtureIds);
```

The package reports threshold behavior; it does not choose or approve a threshold.
