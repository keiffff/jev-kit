export interface BinaryFixture {
  readonly id: string;
  readonly expected: boolean;
  readonly observed: number;
}

export interface BinaryConfusion {
  readonly truePositive: number;
  readonly trueNegative: number;
  readonly falsePositive: number;
  readonly falseNegative: number;
}

export interface ThresholdEvaluation {
  readonly threshold: number;
  readonly total: number;
  readonly confusion: BinaryConfusion;
  readonly precision: number | undefined;
  readonly recall: number | undefined;
  readonly specificity: number | undefined;
  readonly accuracy: number | undefined;
  readonly falsePositiveFixtureIds: readonly string[];
  readonly falseNegativeFixtureIds: readonly string[];
}

export interface LabeledFixture<State> {
  readonly id: string;
  readonly state: State;
  readonly expected: boolean;
}

export interface RunFixtureOptions<State> {
  readonly fixtures: readonly LabeledFixture<State>[];
  readonly threshold: number;
  readonly observe: (state: State, fixture: LabeledFixture<State>) => Promise<number>;
}

export interface DecisionPolicyFixture<Observation> {
  readonly id: string;
  readonly expected: boolean;
  readonly observation: Observation;
}

export interface DecisionPolicyCandidate<Policy> {
  readonly id: string;
  readonly policy: Policy;
}

export interface DecisionPolicyFixtureResult<Observation> {
  readonly id: string;
  readonly expected: boolean;
  readonly selected: boolean;
  readonly correct: boolean;
  readonly observation: Observation;
}

export interface DecisionPolicyEvaluation<Observation> {
  readonly total: number;
  readonly selected: number;
  readonly selectionRate: number | undefined;
  readonly correct: number;
  readonly accuracy: number | undefined;
  readonly selectedPrecision: number | undefined;
  readonly confusion: BinaryConfusion;
  readonly falseAllowFixtureIds: readonly string[];
  readonly falseDeferFixtureIds: readonly string[];
  readonly results: readonly DecisionPolicyFixtureResult<Observation>[];
}

export interface DecisionPolicyCandidateEvaluation<Observation, Policy> {
  readonly id: string;
  readonly policy: Policy;
  readonly calibration: DecisionPolicyEvaluation<Observation>;
  readonly holdout: DecisionPolicyEvaluation<Observation>;
}

export interface DecisionPolicyComparison<Observation, Policy> {
  readonly candidates: readonly DecisionPolicyCandidateEvaluation<Observation, Policy>[];
}

export interface ScoreRun {
  readonly fixtureId: string;
  readonly runId: string;
  readonly scores: Readonly<Record<string, number>>;
}

export interface ScoreDimensionVariation {
  readonly minimum: number;
  readonly maximum: number;
  readonly spread: number;
}

export interface FixtureScoreVariation {
  readonly fixtureId: string;
  readonly runIds: readonly string[];
  readonly dimensions: Readonly<Record<string, ScoreDimensionVariation>>;
}

/** Runs a contract or other observer on labeled cases, then reports threshold behavior. */
export async function runBinaryFixtures<State>(
  options: RunFixtureOptions<State>,
): Promise<ThresholdEvaluation> {
  const observed: BinaryFixture[] = [];
  for (const fixture of options.fixtures) {
    observed.push({
      id: fixture.id,
      expected: fixture.expected,
      observed: await options.observe(fixture.state, fixture),
    });
  }
  return evaluateThreshold(observed, options.threshold);
}

/** Scores labeled fixtures at a caller-supplied threshold; it never chooses a threshold. */
export function evaluateThreshold(
  fixtures: readonly BinaryFixture[],
  threshold: number,
): ThresholdEvaluation {
  assertProbability(threshold, "threshold");
  const ids = new Set<string>();
  let truePositive = 0;
  let trueNegative = 0;
  let falsePositive = 0;
  let falseNegative = 0;
  const falsePositiveFixtureIds: string[] = [];
  const falseNegativeFixtureIds: string[] = [];

  for (const fixture of fixtures) {
    if (fixture.id.trim() === "") throw new Error("fixture id must not be empty");
    if (ids.has(fixture.id)) throw new Error(`duplicate fixture id: ${fixture.id}`);
    ids.add(fixture.id);
    assertProbability(fixture.observed, `fixture ${fixture.id} observed`);
    const predicted = fixture.observed >= threshold;
    if (predicted && fixture.expected) truePositive += 1;
    else if (!predicted && !fixture.expected) trueNegative += 1;
    else if (predicted) {
      falsePositive += 1;
      falsePositiveFixtureIds.push(fixture.id);
    } else {
      falseNegative += 1;
      falseNegativeFixtureIds.push(fixture.id);
    }
  }

  return {
    threshold,
    total: fixtures.length,
    confusion: { truePositive, trueNegative, falsePositive, falseNegative },
    precision: divide(truePositive, truePositive + falsePositive),
    recall: divide(truePositive, truePositive + falseNegative),
    specificity: divide(trueNegative, trueNegative + falsePositive),
    accuracy: divide(truePositive + trueNegative, fixtures.length),
    falsePositiveFixtureIds,
    falseNegativeFixtureIds,
  };
}

/**
 * Compares caller-supplied policies on separate calibration and holdout fixtures.
 * Candidate order is preserved; this function does not select or approve a policy.
 */
export function compareDecisionPolicies<Observation, Policy>(options: {
  readonly calibrationFixtures: readonly DecisionPolicyFixture<Observation>[];
  readonly holdoutFixtures: readonly DecisionPolicyFixture<Observation>[];
  readonly candidates: readonly DecisionPolicyCandidate<Policy>[];
  readonly decide: (observation: Observation, policy: Policy) => boolean;
}): DecisionPolicyComparison<Observation, Policy> {
  validatePolicyFixtures(options.calibrationFixtures, "calibration fixture");
  validatePolicyFixtures(options.holdoutFixtures, "holdout fixture");
  const candidateIds = new Set<string>();
  const candidates = options.candidates.map((candidate) => {
    assertNonempty(candidate.id, "candidate id");
    if (candidateIds.has(candidate.id)) throw new Error(`duplicate candidate id: ${candidate.id}`);
    candidateIds.add(candidate.id);
    return {
      id: candidate.id,
      policy: candidate.policy,
      calibration: evaluateDecisionPolicy(options.calibrationFixtures, candidate.policy, options.decide),
      holdout: evaluateDecisionPolicy(options.holdoutFixtures, candidate.policy, options.decide),
    };
  });
  return { candidates };
}

/** Reports per-score min, max and spread across repeated runs of the same fixtures. */
export function summarizeScoreVariation(runs: readonly ScoreRun[]): readonly FixtureScoreVariation[] {
  const fixtures = new Map<string, { runIds: string[]; scores: Map<string, number[]>; dimensions?: string[] }>();
  const runKeys = new Set<string>();

  for (const run of runs) {
    assertNonempty(run.fixtureId, "fixture id");
    assertNonempty(run.runId, "run id");
    const runKey = `${run.fixtureId}\u0000${run.runId}`;
    if (runKeys.has(runKey)) throw new Error(`duplicate score run: ${run.fixtureId}/${run.runId}`);
    runKeys.add(runKey);

    const dimensions = Object.keys(run.scores).sort();
    const fixture = fixtures.get(run.fixtureId) ?? { runIds: [], scores: new Map<string, number[]>() };
    if (fixture.dimensions !== undefined && !sameStrings(fixture.dimensions, dimensions)) {
      throw new Error(`inconsistent score dimensions for fixture: ${run.fixtureId}`);
    }
    fixture.dimensions = dimensions;
    fixture.runIds.push(run.runId);
    for (const dimension of dimensions) {
      const value = run.scores[dimension];
      assertProbability(value, `fixture ${run.fixtureId} score ${dimension}`);
      const values = fixture.scores.get(dimension) ?? [];
      values.push(value);
      fixture.scores.set(dimension, values);
    }
    fixtures.set(run.fixtureId, fixture);
  }

  return [...fixtures.entries()].map(([fixtureId, fixture]) => ({
    fixtureId,
    runIds: fixture.runIds,
    dimensions: Object.fromEntries([...fixture.scores.entries()].map(([dimension, values]) => {
      const minimum = Math.min(...values);
      const maximum = Math.max(...values);
      return [dimension, { minimum, maximum, spread: maximum - minimum }];
    })),
  }));
}

function evaluateDecisionPolicy<Observation, Policy>(
  fixtures: readonly DecisionPolicyFixture<Observation>[],
  policy: Policy,
  decide: (observation: Observation, policy: Policy) => boolean,
): DecisionPolicyEvaluation<Observation> {
  let truePositive = 0;
  let trueNegative = 0;
  let falsePositive = 0;
  let falseNegative = 0;
  const falseAllowFixtureIds: string[] = [];
  const falseDeferFixtureIds: string[] = [];
  const results: DecisionPolicyFixtureResult<Observation>[] = [];

  for (const fixture of fixtures) {
    const selected = decide(fixture.observation, policy);
    if (typeof selected !== "boolean") throw new TypeError("decide must return a boolean");
    const correct = selected === fixture.expected;
    if (selected && fixture.expected) truePositive += 1;
    else if (!selected && !fixture.expected) trueNegative += 1;
    else if (selected) {
      falsePositive += 1;
      falseAllowFixtureIds.push(fixture.id);
    } else {
      falseNegative += 1;
      falseDeferFixtureIds.push(fixture.id);
    }
    results.push({
      id: fixture.id,
      expected: fixture.expected,
      selected,
      correct,
      observation: fixture.observation,
    });
  }

  const selected = truePositive + falsePositive;
  const correct = truePositive + trueNegative;
  return {
    total: fixtures.length,
    selected,
    selectionRate: divide(selected, fixtures.length),
    correct,
    accuracy: divide(correct, fixtures.length),
    selectedPrecision: divide(truePositive, selected),
    confusion: { truePositive, trueNegative, falsePositive, falseNegative },
    falseAllowFixtureIds,
    falseDeferFixtureIds,
    results,
  };
}

function validatePolicyFixtures<Observation>(
  fixtures: readonly DecisionPolicyFixture<Observation>[],
  name: string,
): void {
  const ids = new Set<string>();
  for (const fixture of fixtures) {
    assertNonempty(fixture.id, `${name} id`);
    if (ids.has(fixture.id)) throw new Error(`duplicate ${name} id: ${fixture.id}`);
    ids.add(fixture.id);
  }
}

function divide(numerator: number, denominator: number): number | undefined {
  return denominator === 0 ? undefined : numerator / denominator;
}

function assertProbability(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`${name} must be a finite number from 0 to 1`);
  }
}

function assertNonempty(value: string, name: string): void {
  if (value.trim() === "") throw new Error(`${name} must not be empty`);
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
