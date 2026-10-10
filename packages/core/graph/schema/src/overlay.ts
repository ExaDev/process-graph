import { z } from "zod";
import type { IdSpace, OpenIds } from "./ids.ts";
import { toPointer } from "./pointer.ts";
import { overlayStatuses, type OverlayStatus } from "./vocabulary.ts";

/**
 * Run state laid over a model, keyed by element identifier. It is separate from the model on purpose, the same rule as layout: a model describes a process, an overlay describes one run of it, and many overlays can sit over one model.
 *
 * An element with no entry has no recorded state, which is distinct from the explicit `"unknown"`, a source reporting that it cannot tell.
 */
export type Overlay<I extends IdSpace> = Readonly<
  Partial<Record<I["element"], OverlayStatus>>
>;

/** The open overlay shape: element identifiers are plain strings. Its inferred type is exactly `Overlay<OpenIds>`. */
export const overlaySchema = z
  .partialRecord(z.string(), z.enum(overlayStatuses))
  .readonly();

/** A shape problem found while loading an overlay. */
export interface OverlayIssue {
  /** RFC 6901 JSON pointer to the offending value in the input; the empty string is the document itself. */
  readonly pointer: string;
  readonly message: string;
}

/** Thrown by `parseOverlay` when the input is not a valid overlay. */
export class OverlayParseError extends Error {
  /** Every problem found. Never empty. */
  readonly issues: readonly OverlayIssue[];

  /**
   * @param issues - The problems found. Must not be empty.
   */
  constructor(issues: readonly OverlayIssue[]) {
    super(
      `Invalid overlay: ${issues
        .map(
          (issue) =>
            `${issue.pointer === "" ? "/" : issue.pointer}: ${issue.message}`,
        )
        .join("; ")}`,
    );
    this.name = "OverlayParseError";
    this.issues = issues;
  }
}

/**
 * Loads an overlay from untrusted input, such as parsed JSON.
 * @param input - The value to load.
 * @returns The overlay, keyed by plain-string element identifiers.
 * @throws OverlayParseError when the input is not an object of element identifier to `"done"`, `"open"` or `"unknown"`.
 */
export const parseOverlay = (input: unknown): Overlay<OpenIds> => {
  const parsed = overlaySchema.safeParse(input);
  if (!parsed.success) {
    throw new OverlayParseError(
      parsed.error.issues.map((issue) => ({
        pointer: toPointer(issue.path),
        message: issue.message,
      })),
    );
  }

  return parsed.data;
};
