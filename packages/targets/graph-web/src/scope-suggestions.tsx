import type {
  ScopeEntry,
  ScopeListing,
} from "@exadev/process-graph-source-contract";
import { useId, useState, type ReactElement } from "react";
import {
  button,
  chip,
  chipList,
  muted,
  row,
  section,
  sectionHeading,
} from "./app.css.ts";
import { failureOf } from "./failure.ts";

/**
 * Lists scopes a page at a time: with no parent, the top-level scopes the token reaches (the source's `scopes.roots`); with one, the scopes inside it (`scopes.children`). `after` resumes a listing from an earlier page's `next`.
 */
export type ScopeLister = (
  parent: string | undefined,
  after: string | undefined,
) => Promise<ScopeListing>;

/** One listing as far as it has been read: its entries so far, where it resumes, and why it stopped if it failed. */
interface Listing {
  readonly entries: readonly ScopeEntry[];
  readonly next: string | undefined;
  readonly loading: boolean;
  readonly problem: string | undefined;
}

const empty: Listing = {
  entries: [],
  next: undefined,
  loading: false,
  problem: undefined,
};

/** The key a listing is kept under: its parent scope, or this for the top level. */
const topLevel = "";

export interface ScopeSuggestionsProps {
  readonly list: ScopeLister;
  /** The scopes already chosen, which are not offered again. */
  readonly scopes: readonly string[];
  readonly onAdd: (scope: string) => void;
}

/**
 * Suggests scopes from what the token reaches: the viewer's account and organisations, and an owner's repositories on request. Nothing is read until asked for, so opening the app spends no requests, and each listing pages on with "More".
 * @param props - The lister, the chosen scopes and what adding does.
 * @returns The suggestions.
 */
export const ScopeSuggestions = (
  props: ScopeSuggestionsProps,
): ReactElement => {
  const { list, scopes, onAdd } = props;
  const [listings, setListings] = useState<ReadonlyMap<string, Listing>>(
    new Map(),
  );
  const headingId = useId();

  const read = (parent: string | undefined): void => {
    const key = parent ?? topLevel;
    const before = listings.get(key) ?? empty;
    const update = (listing: Listing): void => {
      setListings((current) => new Map(current).set(key, listing));
    };
    update({ ...before, loading: true, problem: undefined });
    list(parent, before.next).then(
      (page) => {
        update({
          entries: [...before.entries, ...page.entries],
          next: page.next,
          loading: false,
          problem:
            page.gaps.length === 0
              ? undefined
              : page.gaps.map((gap) => gap.message).join(" "),
        });
      },
      (error: unknown) => {
        update({
          ...before,
          loading: false,
          problem: failureOf(error).message,
        });
      },
    );
  };

  const shown = (
    key: string,
    parent: string | undefined,
  ): ReactElement | null => {
    const listing = listings.get(key);
    if (listing === undefined) {
      return null;
    }
    const offered = listing.entries.filter(
      (entry) => !scopes.includes(entry.scope),
    );

    return (
      <div className={row} data-listing={key}>
        <ul
          aria-label={parent === undefined ? "Your scopes" : `Inside ${parent}`}
          className={chipList}
        >
          {offered.map((entry) => (
            <li
              key={entry.scope}
              className={chip}
              data-suggestion={entry.scope}
            >
              {entry.label}
              {entry.archived ? " (archived)" : ""}
              <button
                type="button"
                className={button}
                aria-label={`Add ${entry.scope}`}
                onClick={() => {
                  onAdd(entry.scope);
                }}
              >
                Add
              </button>
              {parent === undefined ? (
                <button
                  type="button"
                  className={button}
                  aria-label={`Show the repositories of ${entry.scope}`}
                  disabled={listings.get(entry.scope)?.loading === true}
                  onClick={() => {
                    read(entry.scope);
                  }}
                >
                  Repositories
                </button>
              ) : null}
            </li>
          ))}
        </ul>
        {listing.next === undefined ? null : (
          <button
            type="button"
            className={button}
            disabled={listing.loading}
            onClick={() => {
              read(parent);
            }}
          >
            More
          </button>
        )}
        {listing.problem === undefined ? null : (
          <p role="alert" className={muted}>
            {listing.problem}
          </p>
        )}
      </div>
    );
  };

  const owners = listings.get(topLevel)?.entries ?? [];

  return (
    <section
      aria-labelledby={headingId}
      className={section}
      data-screen="suggestions"
    >
      <h2 id={headingId} className={sectionHeading}>
        Suggestions
      </h2>
      {listings.has(topLevel) ? null : (
        <div className={row}>
          <button
            type="button"
            className={button}
            onClick={() => {
              read(undefined);
            }}
          >
            Show my account and organisations
          </button>
        </div>
      )}
      {shown(topLevel, undefined)}
      {owners.map((owner) => (
        <div key={owner.scope}>{shown(owner.scope, owner.scope)}</div>
      ))}
    </section>
  );
};
