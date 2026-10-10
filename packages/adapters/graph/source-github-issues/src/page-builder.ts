import type {
  BoundActivity,
  Gap,
  Relation,
  SourceParticipant,
  SourceTransition,
  SyncPage,
} from "@exadev/process-graph-source-contract";
import { accountId, issueId, repositoryId } from "./identifiers.ts";
import type { Account, IssueRef, User } from "./queries.ts";

/** Collects one page's records, each identifier once, in the order first seen. */
export interface PageBuilder {
  /** Adds an account as a participant: an organisation acts as a system, a user as a role. */
  readonly account: (account: Readonly<Account>) => string;
  /** Adds a repository and its owner as participants, the repository `part-of` the owner. */
  readonly repository: (owner: Readonly<Account>, name: string) => string;
  /** Adds an issue as a bound activity whose actor is its repository, with its state in the overlay. */
  readonly issue: (issue: Readonly<IssueRef>) => string;
  /** Adds an assignee and the `assigned-to` relation from the issue. */
  readonly assignee: (issue: string, user: Readonly<User>) => void;
  /** Adds a blocker and the transition from it to the issue it blocks. */
  readonly blockedBy: (issue: string, blocker: Readonly<IssueRef>) => void;
  /** Adds a sub-issue and the `child-of` relation to its parent. */
  readonly subIssue: (parent: string, child: Readonly<IssueRef>) => void;
  /** Records a gap. */
  readonly gap: (gap: Readonly<Gap>) => void;
  /** The page, with `next` when one is given. */
  readonly build: (next: string | undefined) => SyncPage;
}

/**
 * Starts an empty page.
 * @returns A builder whose `build` returns the page.
 */
export const createPageBuilder = (): PageBuilder => {
  const participants = new Map<string, SourceParticipant>();
  const activities = new Map<string, BoundActivity>();
  const transitions = new Map<string, SourceTransition>();
  const relations = new Map<string, Relation>();
  const overlay = new Map<string, "open" | "done">();
  const gaps: Gap[] = [];

  const relate = (relation: Relation): void => {
    relations.set(
      JSON.stringify([relation.kind, relation.from, relation.to]),
      relation,
    );
  };

  const account = (owner: Readonly<Account>): string => {
    const id = accountId(owner.login);
    participants.set(id, {
      id,
      label: owner.login,
      kind: owner.__typename === "Organization" ? "system" : "role",
    });

    return id;
  };

  const repository = (owner: Readonly<Account>, name: string): string => {
    const ownerParticipant = account(owner);
    const id = repositoryId(owner.login, name);
    participants.set(id, {
      id,
      label: `${owner.login}/${name}`,
      kind: "system",
    });
    relate({ kind: "part-of", from: id, to: ownerParticipant });

    return id;
  };

  const issue = (ref: Readonly<IssueRef>): string => {
    const { owner, name } = ref.repository;
    const actor = repository(owner, name);
    const id = issueId(owner.login, name, ref.number);
    activities.set(id, {
      kind: "activity",
      id,
      source: id,
      label: ref.title,
      actor,
    });
    overlay.set(id, ref.state === "OPEN" ? "open" : "done");

    return id;
  };

  return {
    account,
    repository,
    issue,
    assignee: (issueIdentifier, user) => {
      const id = accountId(user.login);
      participants.set(id, { id, label: user.login, kind: "role" });
      relate({ kind: "assigned-to", from: issueIdentifier, to: id });
    },
    blockedBy: (issueIdentifier, blocker) => {
      const source = issue(blocker);
      const id = `${source}->${issueIdentifier}`;
      transitions.set(id, { id, source, target: issueIdentifier });
    },
    subIssue: (parent, child) => {
      relate({ kind: "child-of", from: issue(child), to: parent });
    },
    gap: (gap) => {
      gaps.push(gap);
    },
    build: (next) => {
      const page = {
        participants: [...participants.values()],
        activities: [...activities.values()],
        transitions: [...transitions.values()],
        relations: [...relations.values()],
        overlay: Object.fromEntries(overlay),
        gaps: [...gaps],
      };

      return next === undefined ? page : { ...page, next };
    },
  };
};
