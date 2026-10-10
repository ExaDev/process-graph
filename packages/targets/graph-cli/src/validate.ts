import { illegalCycles } from "@exadev/process-graph-domain";
import {
  ModelParseError,
  parseModel,
  validate,
  validateOverlay,
  type Model,
  type OpenIds,
} from "@exadev/process-graph-schema";
import { loadRun, type GraphSession } from "./session.ts";

/** One problem with a model. */
export interface ValidationIssue {
  /** What kind of problem: a `validate` issue code, `illegal-cycle`, or `schema` for a document whose shape is wrong. */
  readonly code: string;
  readonly message: string;
  /** Where in a document the problem is, as a JSON pointer, for a shape problem. */
  readonly pointer?: string;
}

/** Whether a model is valid, and every problem found. */
export interface ValidateResult {
  /** True exactly when `issues` is empty. */
  readonly valid: boolean;
  readonly issues: readonly ValidationIssue[];
}

/** A cycle that no decision closes, as an issue: status is undefined on it. */
const cycleIssues = (model: Model<OpenIds>): readonly ValidationIssue[] =>
  illegalCycles(model).map((cycle) => ({
    code: "illegal-cycle",
    message: `cycle with no decision in it: ${cycle.join(" -> ")}`,
  }));

const resultOf = (issues: readonly ValidationIssue[]): ValidateResult => ({
  valid: issues.length === 0,
  issues,
});

/**
 * Checks the session's stored model and run state: the structural rules of `validate`, run state naming elements the model lacks, and cycles no decision closes.
 * @param session - The store and model.
 */
export const validateStored = async (
  session: GraphSession,
): Promise<ValidateResult> => {
  const { model, overlay } = await loadRun(session);

  return resultOf([
    ...validate(model),
    ...validateOverlay(model, overlay),
    ...cycleIssues(model),
  ]);
};

/**
 * Checks a model document, such as a file of JSON: its shape against the model schema (each problem located by JSON pointer), then the structural rules of `validate`, then cycles no decision closes. Text that is not JSON is one `schema` issue at the document itself.
 * @param text - The document.
 */
export const validateDocument = (text: string): ValidateResult => {
  let input: unknown;
  try {
    input = JSON.parse(text);
  } catch (error) {
    return resultOf([
      {
        code: "schema",
        message: `not JSON: ${error instanceof Error ? error.message : String(error)}`,
        pointer: "",
      },
    ]);
  }
  try {
    return resultOf(cycleIssues(parseModel(input)));
  } catch (error) {
    if (!(error instanceof ModelParseError)) {
      throw error;
    }

    return resultOf(
      error.issues.map((issue) =>
        issue.source === "schema"
          ? { code: "schema", message: issue.message, pointer: issue.pointer }
          : { code: issue.code, message: issue.message },
      ),
    );
  }
};
