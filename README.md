# jev-kit

Reusable, versioned decision contracts for Jev.

`jev-kit` turns probabilistic judgments into software components that can be reviewed, tested, calibrated and changed without hiding policy in prompts. It uses the official `@typesafe-ai/sdk`; it is not another Jev HTTP client.

![jev-kit architecture](assets/jev-kit-architecture.svg)

## Why not call an LLM directly?

A direct LLM call is sufficient when the output is prose and no stable control-flow contract is required. It is a poor boundary when application code depends on the result over time.

| Direct model call | `jev-kit` |
| --- | --- |
| A prompt and parsed output are usually coupled to one call site | Questions have a stable contract ID and version |
| Missing, extra or malformed fields can reach application code | Responses are checked against the exact requested keys, answer types and numeric ranges |
| Thresholds and fallback behavior tend to disappear into prompt or glue code | The caller must select a path or defer explicitly |
| A prompt change is difficult to compare with the previous behavior | Labeled fixtures expose false positives and false negatives at caller-owned thresholds |
| Provider retry behavior may be implicit | One library call makes one model attempt; retries are disabled |

The model call is not the differentiator. The differentiator is the durable boundary around it: versioned semantics, runtime conformance, explicit control flow and measurable behavior. Another provider could be supported later only if it satisfies the same boundary.

## Packages

| Package | Responsibility |
| --- | --- |
| `@jev-kit/decision-contract` | Define versioned Jev decisions and validate responses against the exact contract |
| `@jev-kit/decision-router` | Route an application to a named path or return an explicit defer reason |
| `@jev-kit/decision-eval` | Measure false positives and false negatives on labeled decision fixtures |
| `@jev-kit/semantic-diff` | Detect caller-defined semantic changes between a baseline and candidate |
| `@jev-kit/evidence-check` | Measure how supplied evidence supports or contradicts an exact claim |
| `@jev-kit/agent-review` | Apply a versioned permission-review policy to a normalized agent tool request |
| `@jev-kit/hook-adapters` | Convert Codex and Claude Code PermissionRequest payloads to and from the normalized protocol |
| `@jev-kit/cli` | Expose agent review over JSON stdin/stdout for hooks, scripts and non-TypeScript agents |

`decision-contract`, `decision-router` and `decision-eval` are domain-independent. `semantic-diff` and `evidence-check` are reusable contract families, not fixed workflows: callers define their own dimensions, axes, IDs and versions. The built-in contracts are usable defaults and examples of the extension model.

## Agent integration

The adapter layer has one canonical protocol. Agent-specific payloads are normalized before they reach Jev, and Jev results are converted back only at the edge.

```text
Codex PermissionRequest ─┐
Claude PermissionRequest ├─ hook-adapters ─ agent-review ─ decision-contract ─ Jev
custom JSON / Python ────┘                         │
                                                  └─ allow or defer
```

The canonical request and result schemas are published by `@jev-kit/agent-review`:

- `@jev-kit/agent-review/schemas/review-request.json`
- `@jev-kit/agent-review/schemas/review-result.json`

The CLI reads exactly one JSON document from stdin. A normalized caller always receives a normalized result:

```sh
jev-agent-review \
  --adapter normalized \
  --config ./examples/agent-review-policy.json \
  < request.json
```

Codex and Claude Code hook modes emit the native PermissionRequest allow response only when the policy passes. On low scores, sensitive input, missing user context, missing credentials, invalid provider output or provider failure, they emit no decision so the agent's existing review remains in control.

```sh
jev-agent-review \
  --adapter codex-permission \
  --config ./examples/agent-review-policy.json \
  --status-file ~/.codex/hook-state/jev-permission-review/status.json
```

Use `--adapter claude-permission` for Claude Code. API credentials remain environment-owned; the policy file contains no secret. Status aggregation stores the outcome, contract, scores and tool name, never the raw tool input or conversation.

Complete configuration examples are available in [`examples/codex-config.toml`](examples/codex-config.toml) and [`examples/claude-settings.json`](examples/claude-settings.json).

The CLI does not impose an input-length limit or silently retry. `userMessageCount`, when configured, selects how many recent actual user messages the hook adapter supplies and is visible policy rather than a hidden runtime cutoff.

## Example

```ts
import { JevClient, defineContract, noul } from "@jev-kit/decision-contract";
import { defer, routeDecision, selectPath } from "@jev-kit/decision-router";

const permissionContract = defineContract({
  id: "my-product.permission-route",
  version: "1",
  questions: {
    matches_read_only_policy: noul("Does this operation only read the stated target?"),
    has_external_side_effect: noul("Can this operation change external state?"),
  },
});

const client = new JevClient({ apiKey: process.env.TYPESAFE_API_KEY! });

const result = await routeDecision({
  evaluate: () => client.evaluate({
    contract: permissionContract,
    state: request,
  }),
  select: ({ answers }) => {
    if (
      answers.matches_read_only_policy.noul >= 0.8
      && answers.has_external_side_effect.noul <= 0.1
    ) {
      return selectPath("read-only-path");
    }
    return defer("policy-threshold-not-met");
  },
});
```

The numeric policy belongs to the application. `jev-kit` does not invent a global confidence cutoff, retry, approval or fallback action.

## Calibrate a contract

```ts
import { evaluateThreshold } from "@jev-kit/decision-eval";

const report = evaluateThreshold([
  { id: "read-list", expected: true, observed: 0.94 },
  { id: "write-update", expected: false, observed: 0.08 },
  { id: "ambiguous-script", expected: false, observed: 0.73 },
], 0.8);

console.log(report.falsePositiveFixtureIds);
console.log(report.falseNegativeFixtureIds);
```

The evaluator reports what a supplied threshold does to known cases. It deliberately does not declare a threshold acceptable; that is product policy.

## Generalization boundary

Use `jev-kit` for repeated, bounded judgments that affect application control flow and can be represented as typed questions. State may be text or arbitrary JSON-compatible data. Contracts can represent routing, triage, semantic change detection, evidence checking, content classification or other domains without changing the runtime.

Do not use it for long-form generation, open-ended research, code generation or tasks where the output itself is the artifact. A normal LLM interface is the correct abstraction for those cases.

## Invariants

- A contract has a nonempty ID, version and question set.
- A response must contain exactly the requested answer keys.
- Each answer must match its question type and documented numeric range.
- Choice labels, score legends and probability keys must match the contract.
- `JevClient` disables SDK retries at both client and request level.
- Provider failures become an explicit unavailable result only inside `routeDecision`; unrelated programming errors are rethrown.
- Deterministic authorization, schema validation and side-effect controls remain outside model judgment.

## Development

```sh
pnpm install
pnpm check
pnpm pack:check
```

## Releases

Published packages use Changesets. A pull request that changes a public package includes a changeset describing the affected package, semantic-version bump and consumer-visible change:

```sh
pnpm changeset
```

After changes reach `main`, the release workflow maintains a reviewable version PR. Merging that PR publishes the pending packages to npm through GitHub Actions trusted publishing and records package-specific changelogs and tags. The repository stores no npm publishing token.
