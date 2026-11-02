# @jev-kit/cli

Run Jev agent review, evidence checks and semantic diffs from hooks, shell scripts, Python or any process that can exchange JSON over stdin/stdout.

```sh
jev-agent-review --adapter normalized --config ./policy.json < request.json
```

Hook adapters:

```sh
jev-agent-review --adapter codex-permission --config ./policy.json
jev-agent-review --adapter claude-permission --config ./policy.json
```

The API key is read by the official TypeSafe SDK from `TYPESAFE_API_KEY`. Do not place credentials in the policy file. Hook adapters print native allow JSON only after the configured policy passes; a deferred decision produces no hook output.

The evidence and semantic-diff commands accept caller-defined, versioned axes or dimensions. They return measured scores without choosing the caller's threshold or control flow.

```sh
jev-kit-evidence-check < evidence-request.json
jev-kit-semantic-diff < diff-request.json
```

Both commands make one Jev attempt and validate the response against the exact requested contract. Provider failures return a JSON `unavailable` result; malformed input exits with status 2.

Semantic diff accepts an optional boolean `longContext`. It defaults to `false`.
Set it to `true` when a complete document comparison needs TypeSafe's
[long-context mode](https://docs.typesafe.ai/models#long-context). The CLI sends
the official `TypeSafe-Danger-Zone-Long-Context: true` header through the SDK;
it does not truncate the sources or retry a failed request. Long context is
slower and less accurate than the normal context, so it is an explicit choice
for the calling workflow. Permission and evidence checks are unchanged.

Semantic-diff failures retain `errorKind`, `httpStatus` when provided, and the
API's structured `errorType` code (for example `max_tokens_exceeded`). Raw
provider messages, request contents and headers are not included in diagnostics.
