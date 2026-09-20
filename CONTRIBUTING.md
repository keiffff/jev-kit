# Contributing

Install dependencies and run the complete local verification before opening a pull request:

```sh
pnpm install
pnpm check
pnpm pack:check
```

When a change affects a published package, run `pnpm changeset` and include the generated file in the pull request. Choose the semantic-version bump from the public API impact and describe the consumer-visible change. Documentation-only and repository-maintenance changes do not require a changeset.
