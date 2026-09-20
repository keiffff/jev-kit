# @jev-kit/cli

Run Jev agent review from hooks, shell scripts, Python or any process that can exchange JSON over stdin/stdout.

```sh
jev-agent-review --adapter normalized --config ./policy.json < request.json
```

Hook adapters:

```sh
jev-agent-review --adapter codex-permission --config ./policy.json
jev-agent-review --adapter claude-permission --config ./policy.json
```

The API key is read by the official TypeSafe SDK from `TYPESAFE_API_KEY`. Do not place credentials in the policy file. Hook adapters print native allow JSON only after the configured policy passes; a deferred decision produces no hook output.
