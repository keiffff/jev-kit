import { defineContract, noul } from "@jev-kit/decision-contract";
import type { DecisionContract, DecisionResult, EntryType, JevClient, NoulQuestion } from "@jev-kit/decision-contract";

export interface ProofAxis<Id extends string = string> {
  readonly id: Id;
  readonly instructions: string;
}

type QuestionsFor<A extends readonly ProofAxis[]> = { readonly [K in A[number] as K["id"]]: NoulQuestion };

export interface ProofContract<A extends readonly ProofAxis[] = readonly ProofAxis[]> {
  readonly axes: A;
  readonly decision: DecisionContract<string, string, QuestionsFor<A>>;
}

export function defineProofContract<const A extends readonly ProofAxis[]>(input: {
  id: string;
  version: string;
  axes: A;
}): ProofContract<A> {
  if (input.axes.length === 0) throw new Error("proof contract must contain at least one axis");
  const seen = new Set<string>();
  for (const axis of input.axes) {
    if (axis.id.trim() === "") throw new Error("proof axis id must not be empty");
    if (seen.has(axis.id)) throw new Error(`duplicate proof axis id: ${axis.id}`);
    seen.add(axis.id);
  }
  const questions = Object.fromEntries(input.axes.map((axis) => [axis.id, noul(axis.instructions)])) as QuestionsFor<A>;
  return {
    axes: input.axes,
    decision: defineContract({ id: input.id, version: input.version, questions }),
  };
}

export const DEFAULT_PROOF_CONTRACT = defineProofContract({
  id: "jev-kit.claim-evidence",
  version: "1",
  axes: [
    { id: "direct_support", instructions: "Does the supplied evidence directly support the claim at the claim's exact level of specificity? Mere consistency is insufficient." },
    { id: "specificity_supported", instructions: "Does the evidence support every material detail and qualifier asserted by the claim?" },
    { id: "contradicted", instructions: "Does any supplied evidence contradict a material part of the claim?" },
    { id: "alternatives_remain", instructions: "Could another materially different explanation still fit the supplied evidence?" },
  ] as const,
});

export interface VerifyClaimOptions<A extends readonly ProofAxis[]> {
  client: JevClient;
  evidence: EntryType;
  claim: EntryType;
  contract?: ProofContract<A>;
}

export type ProofScores<A extends readonly ProofAxis[]> = { readonly [K in A[number] as K["id"]]: number };

export interface VerifyClaimResult<A extends readonly ProofAxis[]> {
  readonly scores: ProofScores<A>;
  readonly response: DecisionResult<ProofContract<A>["decision"]>;
}

export async function verifyClaim<A extends readonly ProofAxis[] = typeof DEFAULT_PROOF_CONTRACT.axes>(
  options: VerifyClaimOptions<A>,
): Promise<VerifyClaimResult<A>> {
  const contract = options.contract ?? DEFAULT_PROOF_CONTRACT as unknown as ProofContract<A>;
  const response = await options.client.evaluate({
    contract: contract.decision,
    state: { observed_evidence: options.evidence, proposed_claim: options.claim },
  });
  const answers = response.answers as Record<string, { readonly noul: number }>;
  const scores = Object.fromEntries(
    contract.axes.map(({ id }) => [id, answers[id].noul]),
  ) as ProofScores<A>;
  return { scores, response };
}
