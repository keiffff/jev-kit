# @jev-kit/agent-review

Evaluate a normalized AI-agent tool request against a versioned Jev permission policy.

The package returns only `allow` or `defer`. It does not replace deterministic hooks, sandboxing or the agent's native approval system.

```ts
import { definePermissionReviewPolicy, reviewAgentAction } from "@jev-kit/agent-review";
import { JevClient } from "@jev-kit/decision-contract";

const policy = definePermissionReviewPolicy({
  id: "my-agent.permission-review",
  version: "1",
  thresholds: {
    policyCompliant: 0.7,
    instructionAligned: 0.7,
    highRisk: 0.15,
  },
});

const result = await reviewAgentAction({
  client: new JevClient(),
  policy,
  request,
});
```

Machine-readable schemas are exported as `@jev-kit/agent-review/schemas/review-request.json` and `@jev-kit/agent-review/schemas/review-result.json`.
