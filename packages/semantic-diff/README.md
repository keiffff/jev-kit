# @jev-kit/semantic-diff

Measure caller-defined semantic differences between a baseline and candidate with a versioned Jev contract.

```ts
import { JevClient } from "@jev-kit/decision-contract";
import { semanticDiff } from "@jev-kit/semantic-diff";

const result = await semanticDiff({
  client: new JevClient(),
  before: baseline,
  after: candidate,
});

console.log(result.scores);
```

The default contract measures meaning, interface, scope, structure and runtime behavior. Callers can define a different set of dimensions.
