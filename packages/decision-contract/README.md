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
```

One evaluation performs one provider attempt. Contract shape, response keys, answer types and numeric ranges are checked at runtime.
