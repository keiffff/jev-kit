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

function divide(numerator: number, denominator: number): number | undefined {
  return denominator === 0 ? undefined : numerator / denominator;
}

function assertProbability(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`${name} must be a finite number from 0 to 1`);
  }
}
