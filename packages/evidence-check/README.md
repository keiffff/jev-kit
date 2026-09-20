# @jev-kit/evidence-check

Measure whether supplied evidence supports, contradicts or leaves alternatives to an exact claim.

```ts
import { JevClient } from "@jev-kit/decision-contract";
import { verifyClaim } from "@jev-kit/evidence-check";

const result = await verifyClaim({
  client: new JevClient(),
  evidence,
  claim,
});

console.log(result.scores);
```

The default contract separates direct support, supported specificity, contradiction and remaining alternatives. Callers retain the final judgment.
