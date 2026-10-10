import type { Model } from "./model.ts";
import type { OpenIds } from "./ids.ts";
import { modelSchema } from "./schema.ts";
import { validate, type IssueCode } from "./validate.ts";

/** A problem found while loading a model: a shape violation located by JSON pointer, or a rule `validate` reports. */
export type ModelIssue =
  | {
      readonly source: "schema";
      /** RFC 6901 JSON pointer to the offending value in the input; the empty string is the document itself. */
      readonly pointer: string;
      readonly message: string;
    }
  | {
      readonly source: "validate";
      readonly code: IssueCode;
      readonly message: string;
    };

/** Thrown by `parseModel` when the input is not a valid model. */
export class ModelParseError extends Error {
  /** Every problem found, in the order the schema and then `validate` reported them. Never empty. */
  readonly issues: readonly ModelIssue[];

  /**
   * @param issues - The problems found. Must not be empty.
   */
  constructor(issues: readonly ModelIssue[]) {
    super(
      `Invalid model: ${issues
        .map((issue) =>
          issue.source === "schema"
            ? `${issue.pointer === "" ? "/" : issue.pointer}: ${issue.message}`
            : issue.message,
        )
        .join("; ")}`,
    );
    this.name = "ModelParseError";
    this.issues = issues;
  }
}

/** Encodes one path as an RFC 6901 JSON pointer, escaping `~` and `/` inside a segment. */
const toPointer = (path: readonly PropertyKey[]): string =>
  path
    .map(
      (segment) =>
        `/${String(segment).replaceAll("~", "~0").replaceAll("/", "~1")}`,
    )
    .join("");

/**
 * Loads a model from untrusted input, such as parsed JSON.
 *
 * The input is checked against the open schema first, so every shape problem is reported with the JSON pointer of the offending value. Only a well-shaped model is then passed to `validate`, whose issues are surfaced the same way.
 * @param input - The value to load.
 * @returns The validated model, with identifiers as plain strings.
 * @throws ModelParseError when the input is not a well-shaped model or fails `validate`.
 */
export const parseModel = (input: unknown): Model<OpenIds> => {
  const parsed = modelSchema.safeParse(input);
  if (!parsed.success) {
    throw new ModelParseError(
      parsed.error.issues.map((issue) => ({
        source: "schema",
        pointer: toPointer(issue.path),
        message: issue.message,
      })),
    );
  }

  const issues = validate(parsed.data);
  if (issues.length > 0) {
    throw new ModelParseError(
      issues.map((issue) => ({
        source: "validate",
        code: issue.code,
        message: issue.message,
      })),
    );
  }

  return parsed.data;
};
