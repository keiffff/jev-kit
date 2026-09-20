# @jev-kit/decision-router

Route application control flow from a decision result, or return an explicit defer reason when no path is selected or Jev is unavailable.

```ts
import { defer, routeDecision, selectPath } from "@jev-kit/decision-router";

const result = await routeDecision({
  evaluate: loadDecision,
  select: ({ score }) => score >= 0.8 ? selectPath("accept") : defer("below-threshold"),
});
```

The caller owns thresholds, path names and fallback behavior.
