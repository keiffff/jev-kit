import { defineContract, noul } from "@jev-kit/decision-contract";
import type { DecisionContract, DecisionResult, EntryType, JevClient, NoulQuestion } from "@jev-kit/decision-contract";

export interface DiffDimension<Id extends string = string> {
  readonly id: Id;
  readonly instructions: string;
}

type QuestionsFor<D extends readonly DiffDimension[]> = { readonly [K in D[number] as K["id"]]: NoulQuestion };

export interface DiffContract<D extends readonly DiffDimension[] = readonly DiffDimension[]> {
  readonly dimensions: D;
  readonly decision: DecisionContract<string, string, QuestionsFor<D>>;
}

export function defineDiffContract<const D extends readonly DiffDimension[]>(input: {
  id: string;
  version: string;
  dimensions: D;
}): DiffContract<D> {
  if (input.dimensions.length === 0) throw new Error("diff contract must contain at least one dimension");
  const seen = new Set<string>();
  for (const dimension of input.dimensions) {
    if (dimension.id.trim() === "") throw new Error("diff dimension id must not be empty");
    if (seen.has(dimension.id)) throw new Error(`duplicate diff dimension id: ${dimension.id}`);
    seen.add(dimension.id);
  }
  const questions = Object.fromEntries(
    input.dimensions.map((dimension) => [dimension.id, noul(dimension.instructions)]),
  ) as QuestionsFor<D>;
  return {
    dimensions: input.dimensions,
    decision: defineContract({ id: input.id, version: input.version, questions }),
  };
}

export const DEFAULT_DIFF_CONTRACT = defineDiffContract({
  id: "jev-kit.semantic-diff",
  version: "1",
  dimensions: [
    { id: "meaning", instructions: "Does the candidate change factual claims, roles, flows, conclusions, or obligations?" },
    { id: "interface", instructions: "Does the candidate change a public API, schema, persisted format, configuration contract, or external behavior?" },
    { id: "scope", instructions: "Does the candidate expand the requested scope or modify material outside the stated change?" },
    { id: "structure", instructions: "Does the candidate change hierarchy, layout, grouping, ordering, or information placement?" },
    { id: "runtime_behavior", instructions: "Does the candidate change scripts, interactions, embeds, media, controls, loading, or another runtime path?" },
  ] as const,
});

export interface SemanticDiffOptions<D extends readonly DiffDimension[]> {
  client: JevClient;
  before: EntryType;
  after: EntryType;
  contract?: DiffContract<D>;
}

export type DiffScores<D extends readonly DiffDimension[]> = { readonly [K in D[number] as K["id"]]: number };

export interface SemanticDiffResult<D extends readonly DiffDimension[]> {
  readonly scores: DiffScores<D>;
  readonly response: DecisionResult<DiffContract<D>["decision"]>;
}

export async function semanticDiff<D extends readonly DiffDimension[] = typeof DEFAULT_DIFF_CONTRACT.dimensions>(
  options: SemanticDiffOptions<D>,
): Promise<SemanticDiffResult<D>> {
  const contract = options.contract ?? DEFAULT_DIFF_CONTRACT as unknown as DiffContract<D>;
  const response = await options.client.evaluate({
    contract: contract.decision,
    state: { before: options.before, after: options.after },
  });
  const answers = response.answers as Record<string, { readonly noul: number }>;
  const scores = Object.fromEntries(
    contract.dimensions.map(({ id }) => [id, answers[id].noul]),
  ) as DiffScores<D>;
  return { scores, response };
}
