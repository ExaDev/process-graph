import type { Model, OpenIds } from "@exadev/process-graph-schema";
import type { GraphStoreClient } from "./contract.ts";
import type { BoundItems, StoreChange } from "./schema.ts";

/** The settled error of a call that must fail, so its code and data can be asserted. */
export const failureOf = async (
  call: Readonly<Promise<unknown>>,
): Promise<unknown> => {
  try {
    await call;
  } catch (error) {
    return error;
  }
  throw new Error("expected the call to fail");
};

/** A two-step model whose only transition can be broken by an upsert. */
export const pairModel: Model<OpenIds> = {
  participants: [{ id: "team", label: "Team", kind: "role" }],
  events: [],
  actions: [],
  artefacts: [],
  elements: [
    { kind: "activity", id: "plan", label: "Plan", actor: "team" },
    { kind: "activity", id: "build", label: "Build", actor: "team" },
  ],
  transitions: [{ id: "plan-build", source: "plan", target: "build" }],
  fragments: [],
  projections: [],
};

/** Items as a source would send them: one new repository participant, two issues, one replacing an existing activity, and a dependency. */
export const issueItems: BoundItems = {
  participants: [
    { id: "github:org/repo", label: "org/repo", kind: "system" },
    { id: "team", label: "Platform team", kind: "role" },
  ],
  activities: [
    {
      kind: "activity",
      id: "github:org/repo#1",
      label: "Design the schema",
      actor: "github:org/repo",
      source: "github:org/repo#1",
    },
    {
      kind: "activity",
      id: "github:org/repo#2",
      label: "Write the migration",
      actor: "team",
      source: "github:org/repo#2",
    },
  ],
  transitions: [
    { id: "dep-1-2", source: "github:org/repo#1", target: "github:org/repo#2" },
  ],
  overlay: { "github:org/repo#1": "done" },
};

/** An activity bound to its own identifier, as a source sends it. */
const bound = (id: string, label: string) =>
  ({
    kind: "activity",
    id,
    label,
    actor: "github:org/repo",
    source: id,
  }) as const;

/**
 * A work hierarchy as a source sends it: an epic with two children, one of which has a child of its own, an assignee, the repository inside its organisation, and a pair of activities each the parent of the other, so a walk over a cycle of `child-of` relations is exercised.
 */
export const hierarchyItems: BoundItems = {
  participants: [
    { id: "github:@org", label: "org", kind: "system" },
    { id: "github:org/repo", label: "org/repo", kind: "system" },
    { id: "github:@ada", label: "ada", kind: "role" },
  ],
  activities: [
    bound("github:org/repo#1", "Epic"),
    bound("github:org/repo#2", "Store"),
    bound("github:org/repo#3", "Client"),
    bound("github:org/repo#4", "Migrations"),
    bound("github:org/repo#5", "Loop one"),
    bound("github:org/repo#6", "Loop two"),
  ],
  transitions: [],
  overlay: {},
  relations: [
    { kind: "child-of", from: "github:org/repo#3", to: "github:org/repo#1" },
    { kind: "child-of", from: "github:org/repo#2", to: "github:org/repo#1" },
    { kind: "child-of", from: "github:org/repo#4", to: "github:org/repo#2" },
    { kind: "assigned-to", from: "github:org/repo#2", to: "github:@ada" },
    { kind: "part-of", from: "github:org/repo", to: "github:@org" },
    { kind: "child-of", from: "github:org/repo#5", to: "github:org/repo#6" },
    { kind: "child-of", from: "github:org/repo#6", to: "github:org/repo#5" },
  ],
};

/** Reads a subscription up to and including the first event `last` accepts, then stops it. */
export const takeUntil = async (
  events: Readonly<AsyncIterable<StoreChange>>,
  last: (change: StoreChange) => boolean,
): Promise<readonly StoreChange[]> => {
  const received: StoreChange[] = [];
  for await (const event of events) {
    received.push(event);
    if (last(event)) {
      break;
    }
  }

  return received;
};

/** Reads the first event of a subscription, then stops it. */
export const firstOf = async (
  events: Readonly<AsyncIterable<StoreChange>>,
): Promise<readonly StoreChange[]> => takeUntil(events, () => true);

/**
 * Runs steps one after another, each starting once the one before has settled, as consecutive writes from one client do.
 * @param steps - The steps, in order.
 * @returns Each step's result, in order.
 */
export const inSequence = async <T>(
  steps: readonly (() => Promise<T>)[],
): Promise<readonly T[]> =>
  steps.reduce<Promise<readonly T[]>>(
    async (done, step) => [...(await done), await step()],
    Promise.resolve([]),
  );

/**
 * The revisions a subscriber lost without being told: every change must arrive in commit order, except that a `missed` event may stand in for any run of changes before the next one that arrives.
 * @param received - What the subscriber received, in order.
 * @param written - The revisions committed, in order.
 * @returns The revisions skipped with no `missed` in their place, plus any received out of order. Empty when the subscription kept its contract.
 */
export const silentLosses = (
  received: readonly StoreChange[],
  written: readonly number[],
): readonly number[] => {
  const lost: number[] = [];
  let expected = 0;
  let excused = false;
  for (const change of received) {
    if (change.kind === "missed") {
      excused = true;
      continue;
    }
    const position = written.indexOf(change.revision);
    if (position < expected) {
      lost.push(change.revision);
      continue;
    }
    if (!excused) {
      lost.push(...written.slice(expected, position));
    }
    expected = position + 1;
    excused = false;
  }
  if (!excused) {
    lost.push(...written.slice(expected));
  }

  return lost;
};

/** Makes a client for a store with no models in it, and the function that closes it once a test ends. */
export type ClientFactory = () => Promise<{
  readonly client: GraphStoreClient;
  readonly close: () => Promise<void>;
}>;

/** Runs a test body against a fresh client and closes it afterwards, pass or fail. */
export const withClient =
  (
    createClient: ClientFactory,
    body: (client: GraphStoreClient) => Promise<void>,
  ) =>
  async (): Promise<void> => {
    const { client, close } = await createClient();
    try {
      await body(client);
    } finally {
      await close();
    }
  };
