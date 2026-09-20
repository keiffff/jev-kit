import { JevEvaluationError } from "@jev-kit/decision-contract";

export interface SelectedPath<Path> { readonly outcome: "selected"; readonly path: Path }
export interface DeferredPath<Reason extends string = string> { readonly outcome: "deferred"; readonly reason: Reason }
export type PathSelection<Path, Reason extends string = string> = SelectedPath<Path> | DeferredPath<Reason>;

export function selectPath<const Path>(path: Path): SelectedPath<Path> {
  return { outcome: "selected", path };
}

export function defer<const Reason extends string>(reason: Reason): DeferredPath<Reason> {
  return { outcome: "deferred", reason };
}

export interface BranchOptions<Response, Path, Reason extends string> {
  evaluate: () => Promise<Response>;
  select: (response: Response) => PathSelection<Path, Reason>;
}

export interface SelectedBranch<Response, Path> {
  readonly status: "selected";
  readonly path: Path;
  readonly response: Response;
}

export interface SelectionDeferredBranch<Response, Reason extends string> {
  readonly status: "deferred";
  readonly reason: Reason;
  readonly response: Response;
}

export interface UnavailableBranch {
  readonly status: "deferred";
  readonly reason: "unavailable";
  readonly error?: { readonly kind: JevEvaluationError["kind"]; readonly status?: number };
}

export type BranchResult<Response, Path, Reason extends string> =
  | SelectedBranch<Response, Path>
  | SelectionDeferredBranch<Response, Reason>
  | UnavailableBranch;

export async function routeDecision<Response, Path, Reason extends string>(
  options: BranchOptions<Response, Path, Reason>,
): Promise<BranchResult<Response, Path, Reason>> {
  let response: Response;
  try {
    response = await options.evaluate();
  } catch (error) {
    if (!(error instanceof JevEvaluationError)) throw error;
    return { status: "deferred", reason: "unavailable", error: { kind: error.kind, status: error.status } };
  }
  const selection = options.select(response);
  if (selection.outcome === "deferred") return { status: "deferred", reason: selection.reason, response };
  return { status: "selected", path: selection.path, response };
}
