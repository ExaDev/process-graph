import { CycleError, UnknownNodeError } from "@exadev/process-graph-dag";
import { ModelParseError } from "@exadev/process-graph-schema";
import { GraphSourceError } from "@exadev/process-graph-source-contract";
import { ORPCError } from "@orpc/server";
import { CommanderError } from "commander";
import { exitCodes, type ExitCode } from "./exit-codes.ts";

/** A failure the command line reports with its own exit status and message, and nothing else. */
export class CliError extends Error {
  /** The exit status the failure maps to. */
  readonly exitCode: ExitCode;

  /**
   * @param exitCode - The exit status to report.
   * @param message - What went wrong, as one line for standard error.
   * @param options - The underlying error, kept as the cause.
   */
  constructor(exitCode: ExitCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "CliError";
    this.exitCode = exitCode;
  }
}

/** The store's codes for a missing model or element and for a change that would leave the model invalid. */
const notFoundCode = "NOT_FOUND";
const unprocessableCode = "UNPROCESSABLE_CONTENT";

/** The codes a source answers with when it refuses a sync. */
const sourceRefusalCodes: ReadonlySet<string> = new Set([
  "UNAUTHORIZED",
  "TOO_MANY_REQUESTS",
  "BAD_REQUEST",
]);

/** The issues an `UNPROCESSABLE_CONTENT` error carries, each as `code: message`, or nothing when its data has no issues. */
const issueLines = (data: unknown): readonly string[] => {
  if (
    typeof data !== "object" ||
    data === null ||
    !("issues" in data) ||
    !Array.isArray(data.issues)
  ) {
    return [];
  }
  const issues: readonly unknown[] = data.issues;

  return issues.flatMap((issue) =>
    typeof issue === "object" &&
    issue !== null &&
    "code" in issue &&
    "message" in issue &&
    typeof issue.code === "string" &&
    typeof issue.message === "string"
      ? [`${issue.code}: ${issue.message}`]
      : [],
  );
};

/**
 * The error underneath a source's failure, for a failure's cause. A source called in process through oRPC fails with an `ORPCError` whose cause is the `GraphSourceError` the source threw, whose own cause, when it has one, is what went wrong underneath, such as a token port's error. Those two layers say nothing more than the failure's message and exit status already do, so the innermost error is the one worth keeping.
 * @param error - What the source call threw.
 * @returns The `GraphSourceError`'s cause when it has one, otherwise that `GraphSourceError`; anything else as it is.
 */
export const underlyingCause = (error: unknown): unknown => {
  const sourceError =
    error instanceof ORPCError && error.cause instanceof GraphSourceError
      ? error.cause
      : error;
  if (!(sourceError instanceof GraphSourceError)) {
    return error;
  }

  return sourceError.cause === undefined ? sourceError : sourceError.cause;
};

/** The exit status and message an error is reported with. */
export interface Failure {
  readonly exitCode: ExitCode;
  readonly message: string;
}

/**
 * Classifies anything a command threw into its exit status and the message for standard error. A commander usage error has already printed its own message, so it is reported with an empty one.
 * @param error - What was thrown.
 * @returns The exit status and message.
 */
export const failureOf = (error: unknown): Failure => {
  if (error instanceof CliError) {
    return { exitCode: error.exitCode, message: error.message };
  }
  if (error instanceof CommanderError) {
    return {
      exitCode:
        error.exitCode === exitCodes.success
          ? exitCodes.success
          : exitCodes.usage,
      message: "",
    };
  }
  if (error instanceof CycleError) {
    return {
      exitCode: exitCodes.invalidModel,
      message: `${error.message}; run cycles to list them`,
    };
  }
  if (error instanceof UnknownNodeError) {
    return { exitCode: exitCodes.notFound, message: error.message };
  }
  if (error instanceof ModelParseError) {
    return { exitCode: exitCodes.invalidModel, message: error.message };
  }
  if (error instanceof ORPCError) {
    const code: unknown = error.code;
    const data: unknown = error.data;
    if (code === notFoundCode) {
      return { exitCode: exitCodes.notFound, message: error.message };
    }
    if (code === unprocessableCode) {
      return {
        exitCode: exitCodes.invalidModel,
        message: [error.message, ...issueLines(data)].join("\n"),
      };
    }
    if (typeof code === "string" && sourceRefusalCodes.has(code)) {
      return { exitCode: exitCodes.sourceFailure, message: error.message };
    }
  }

  return {
    exitCode: exitCodes.failure,
    message: error instanceof Error ? error.message : String(error),
  };
};
