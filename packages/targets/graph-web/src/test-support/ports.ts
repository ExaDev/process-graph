import type { FlowLayoutOptions } from "@exadev/process-graph-react-flow";
import {
  createFakeGraphSource,
  createGraphSourceRouter,
  type FakePage,
  type GraphSourcePager,
  type ScopeEntry,
} from "@exadev/process-graph-source-contract";
import {
  createFakeGraphStore,
  createGraphStoreRouter,
} from "@exadev/process-graph-store-contract";
import { createRouterClient } from "@orpc/server";
import type {
  AppPorts,
  DownloadFile,
  Observable,
  ThemePreference,
} from "../ports.ts";
import type { SyncRecord } from "../sync-record.ts";

/** A value a test changes, observed as the app observes the browser. */
interface Settable<T> {
  readonly observable: Observable<T>;
  readonly set: (value: T) => void;
}

/**
 * An observable value a test sets.
 * @param initial - The first value.
 */
const settable = <T>(initial: T): Settable<T> => {
  let value = initial;
  const listeners = new Set<() => void>();

  return {
    observable: {
      get: () => value,
      subscribe: (listener) => {
        listeners.add(listener);

        return () => {
          listeners.delete(listener);
        };
      },
    },
    set: (next) => {
      value = next;
      for (const listener of listeners) {
        listener();
      }
    },
  };
};

type LayoutEngine = NonNullable<FlowLayoutOptions["engine"]>;

/** A layout engine that needs no elkjs: every node in one row, each a layer gap after the one before, and each group wrapped around its children. */
const rowEngine: LayoutEngine = {
  arrange: async (graph) => {
    let x = 0;
    const leaf = (node: (typeof graph.nodes)[number]) => {
      const box = {
        id: node.id,
        x,
        y: graph.groupPadding,
        width: node.width,
        height: node.height,
      };
      x += node.width + graph.layerGap;

      return box;
    };

    return Promise.resolve(
      graph.nodes.flatMap((node) => {
        if (node.children === undefined || node.children.length === 0) {
          return [leaf(node)];
        }
        const children = node.children.map(leaf);
        const left =
          Math.min(...children.map((child) => child.x)) - graph.groupPadding;
        const right =
          Math.max(...children.map((child) => child.x + child.width)) +
          graph.groupPadding;

        return [
          {
            id: node.id,
            x: left,
            y: 0,
            width: right - left,
            height:
              graph.groupPadding * 2 +
              Math.max(...children.map((child) => child.height)),
          },
          ...children,
        ];
      }),
    );
  },
};

/** One issue of the fake GitHub source. */
interface Issue {
  readonly id: string;
  readonly label: string;
  readonly repository: string;
  readonly state: "done" | "open";
  readonly blockedBy: readonly string[];
  /** The issue this one is a sub-issue of. */
  readonly parent?: string;
}

const repositoryParticipant = (repository: string) => ({
  id: repository,
  label: repository.slice(repository.indexOf(":") + 1),
  kind: "system" as const,
});

/**
 * A page of the fake GitHub source, built as the real adapter builds one: each issue a bound activity whose actor is its repository, each blocker a transition from it to the issue it blocks, each sub-issue `child-of` its parent, and the state in the overlay.
 * @param issues - The page's issues, with every blocker among them.
 */
const pageOf = (issues: readonly Issue[]): FakePage => ({
  participants: [...new Set(issues.map((issue) => issue.repository))].map(
    repositoryParticipant,
  ),
  activities: issues.map((issue) => ({
    kind: "activity",
    id: issue.id,
    label: issue.label,
    source: issue.id,
    actor: issue.repository,
  })),
  transitions: issues.flatMap((issue) =>
    issue.blockedBy.map((blocker) => ({
      id: `${blocker}->${issue.id}`,
      source: blocker,
      target: issue.id,
    })),
  ),
  relations: issues.flatMap((issue) =>
    issue.parent === undefined
      ? []
      : [{ kind: "child-of" as const, from: issue.id, to: issue.parent }],
  ),
  overlay: Object.fromEntries(issues.map((issue) => [issue.id, issue.state])),
  gaps: [],
});

const sdk: Issue = {
  id: "github:partner/sdk#1",
  label: "Publish the SDK",
  repository: "github:partner/sdk",
  state: "open",
  blockedBy: [],
};

/** Documentation for the page, a finished sub-issue of it in another organisation's repository. */
const docs: Issue = {
  id: "github:partner/docs#1",
  label: "Document the page",
  repository: "github:partner/docs",
  state: "done",
  blockedBy: [],
  parent: "github:acme/web#1",
};

/** An issue in the same repository as `docs` that nothing links to, so only a sync of that repository reads it. */
const guide: Issue = {
  id: "github:partner/docs#2",
  label: "Proofread the guide",
  repository: "github:partner/docs",
  state: "done",
  blockedBy: [],
};

/** The first page of the fake `github:acme` scope: the API repository's issues. */
const apiPage: FakePage = pageOf([
  {
    id: "github:acme/api#1",
    label: "Design the schema",
    repository: "github:acme/api",
    state: "done",
    blockedBy: [],
  },
  {
    id: "github:acme/api#2",
    label: "Build the endpoint",
    repository: "github:acme/api",
    state: "open",
    blockedBy: ["github:acme/api#1"],
  },
]);

/** The second page of the fake `github:acme` scope: the web repository's issues, with the blockers they reach in another repository and another organisation. */
const webPage: FakePage = pageOf([
  {
    id: "github:acme/api#2",
    label: "Build the endpoint",
    repository: "github:acme/api",
    state: "open",
    blockedBy: [],
  },
  sdk,
  docs,
  {
    id: "github:acme/web#1",
    label: "Build the page",
    repository: "github:acme/web",
    state: "open",
    blockedBy: ["github:acme/api#2", "github:partner/sdk#1"],
    parent: "github:acme/web#2",
  },
  {
    id: "github:acme/web#2",
    label: "Ship the release",
    repository: "github:acme/web",
    state: "open",
    blockedBy: ["github:acme/web#1"],
  },
]);

const entry = (scope: string, label: string): ScopeEntry => ({
  scope,
  label,
  archived: false,
});

/** What the fake source's `scopes.roots` lists: the viewer and an organisation. */
const fakeRoots: readonly ScopeEntry[] = [
  entry("github:alice", "alice"),
  entry("github:acme", "acme"),
];

/** What the fake source's `scopes.children` lists inside each owner. */
const fakeChildren: Readonly<Record<string, readonly ScopeEntry[]>> = {
  "github:acme": [
    entry("github:acme/api", "acme/api"),
    { ...entry("github:acme/legacy", "acme/legacy"), archived: true },
    entry("github:acme/web", "acme/web"),
  ],
};

/** The fake GitHub source's scopes. */
export const fakeScopes: Readonly<Record<string, readonly FakePage[]>> = {
  "github:acme": [apiPage, webPage],
  "github:partner/sdk": [pageOf([sdk])],
  "github:partner/docs": [pageOf([docs, guide])],
};

/** What a test can do to the ports beyond what the app does. */
export interface TestPorts {
  readonly ports: AppPorts;
  readonly address: Settable<string>;
  readonly online: Settable<boolean>;
  readonly prefersDark: Settable<boolean>;
  readonly updateAvailable: Settable<boolean>;
  /** How many times the app asked to apply an update. */
  readonly updatesApplied: () => number;
  /** The tokens the sources were built with, in order. */
  readonly tokensUsed: readonly string[];
  readonly records: ReadonlyMap<string, SyncRecord>;
  readonly savedToken: () => string | undefined;
  /** The files the app handed over to save, in order. */
  readonly downloads: readonly DownloadFile[];
}

export interface TestPortOptions {
  readonly search?: string;
  readonly token?: string;
  /** The GitHub pager; the fake source over `fakeScopes` by default. */
  readonly pager?: GraphSourcePager;
  readonly records?: readonly SyncRecord[];
}

/**
 * The app's ports over in-memory fakes: the store contract's fake store and the source contract's fake source, each called through its oRPC client as in the app; an address, network, colour scheme and update that a test sets; and the device's storage in memory.
 * @param options - The starting address, a saved token, the source's pager and sync records.
 */
export const testPorts = (options: TestPortOptions = {}): TestPorts => {
  const address = settable(options.search ?? "");
  const online = settable(true);
  const prefersDark = settable(false);
  const updateAvailable = settable(false);
  let applied = 0;
  let token = options.token;
  let theme: ThemePreference = "system";
  const tokensUsed: string[] = [];
  const downloads: DownloadFile[] = [];
  const records = new Map(
    (options.records ?? []).map((record) => [record.modelId, record]),
  );
  const pager =
    options.pager ??
    createFakeGraphSource({
      source: "github",
      scopes: fakeScopes,
      roots: fakeRoots,
      children: fakeChildren,
      // Smaller than the owner's repository listing, so a listing pages.
      listingPageSize: 2,
    });

  const ports: AppPorts = {
    store: createRouterClient(createGraphStoreRouter(createFakeGraphStore())),
    sources: (used) => (prefix) => {
      tokensUsed.push(used);

      return prefix === "github"
        ? createRouterClient(createGraphSourceRouter(pager))
        : undefined;
    },
    token: {
      read: () => token,
      write: (next) => {
        token = next;
      },
      clear: () => {
        token = undefined;
      },
    },
    syncRecords: {
      read: (modelId) => records.get(modelId),
      write: (record) => {
        records.set(record.modelId, record);
      },
    },
    themePreference: {
      read: () => theme,
      write: (preference) => {
        theme = preference;
      },
    },
    address: { search: address.observable, replace: address.set },
    online: online.observable,
    prefersDark: prefersDark.observable,
    updates: {
      available: updateAvailable.observable,
      apply: () => {
        applied += 1;
      },
    },
    layout: { engine: rowEngine },
    download: (file) => {
      downloads.push(file);
    },
  };

  return {
    ports,
    address,
    online,
    prefersDark,
    updateAvailable,
    updatesApplied: () => applied,
    tokensUsed,
    records,
    savedToken: () => token,
    downloads,
  };
};
