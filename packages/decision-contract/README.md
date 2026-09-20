# @jev-kit/decision-contract

Define versioned Jev decision contracts and validate provider responses before application code uses them.

```ts
import { JevClient, defineContract, noul } from "@jev-kit/decision-contract";

const contract = defineContract({
  id: "example.permission",
  version: "1",
  questions: {
    allowed: noul("Does the request comply with the supplied policy?"),
  },
});

const result = await new JevClient().evaluate({ contract, state: request });
console.log(result.answers.allowed.noul);
console.log(result.contract.fingerprint);
```

One evaluation performs one provider attempt. Contract shape, response keys, answer types and numeric ranges are checked at runtime.

`defineContract` also produces a deterministic SHA-256 fingerprint from the contract ID, version and question semantics. Persist it with evaluation output when decisions must be reproduced or audited. `assertContractVersioning(previous, current)` rejects a changed contract that reuses the same ID and version.
