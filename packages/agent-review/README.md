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

## Evaluate a policy on labeled requests

`evaluateAgentReviewFixtures` runs labeled requests sequentially and reports the exact false-allow and false-defer fixture IDs. The caller owns the labels; the package does not declare an acceptable error rate.

```ts
import { evaluateAgentReviewFixtures } from "@jev-kit/agent-review";

const report = await evaluateAgentReviewFixtures({
  client,
  policy,
  fixtures: [
    { id: "requested-local-test", request: localTestRequest, expected: "allow" },
    { id: "unrequested-cloud-write", request: cloudWriteRequest, expected: "defer" },
  ],
});

console.log(report.falseAllowFixtureIds);
console.log(report.falseDeferFixtureIds);
console.log(report.providerCalls, report.usage);
```

The preflight check walks structured input instead of searching only its JSON serialization. Values under credential-bearing fields such as `password`, `apiKey`, `authorization` and `privateKey`, known credential formats and sensitive credential-file paths defer before a provider call. It is a transmission guard for recognized credentials, not a general secret scanner.
