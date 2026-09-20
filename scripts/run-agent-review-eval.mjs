import { readFile } from "node:fs/promises";
import {
  definePermissionReviewPolicy,
  evaluateAgentReviewFixtures,
} from "../packages/agent-review/dist/index.js";
import { JevClient } from "../packages/decision-contract/dist/index.js";

const config = JSON.parse(await readFile(
  new URL("../examples/agent-review-policy.json", import.meta.url),
  "utf8",
));
const fixtureDefinitions = JSON.parse(await readFile(
  new URL("../evals/agent-review/workflow-fixtures.json", import.meta.url),
  "utf8",
));
const fixtures = fixtureDefinitions.map((fixture) => ({
  ...fixture,
  request: {
    ...fixture.request,
    context: { ...fixture.request.context, standingPolicy: config.standingPolicy },
  },
}));

const policy = definePermissionReviewPolicy(config.policy);
const report = await evaluateAgentReviewFixtures({
  client: new JevClient({ defaultModel: config.model }),
  policy,
  fixtures,
});

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
