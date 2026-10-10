import type {
  FakeGraphSourceOptions,
  FakePage,
} from "@exadev/process-graph-source-contract";

const acme = { id: "github:@acme", label: "acme", kind: "system" } as const;
const app = {
  id: "github:acme/app",
  label: "acme/app",
  kind: "system",
} as const;
const web = {
  id: "github:acme/web",
  label: "acme/web",
  kind: "system",
} as const;
const alice = { id: "github:@alice", label: "alice", kind: "role" } as const;

const issue = (
  repo: typeof app | typeof web,
  number: string,
  label: string,
) => {
  const id = `${repo.id}#${number}`;

  return { kind: "activity", id, source: id, label, actor: repo.id } as const;
};

const design = issue(app, "1", "Design the schema");
const api = issue(app, "2", "Build the API");
const ship = issue(app, "3", "Ship it");
const ui = issue(web, "7", "Build the UI");

const blocks = (
  blocker: Readonly<{ id: string }>,
  blocked: Readonly<{ id: string }>,
) => ({
  id: `${blocker.id}->${blocked.id}`,
  source: blocker.id,
  target: blocked.id,
});

const appFirst: FakePage = {
  participants: [acme, app, alice],
  activities: [design, api],
  transitions: [blocks(design, api)],
  relations: [
    { kind: "part-of", from: app.id, to: acme.id },
    { kind: "assigned-to", from: api.id, to: alice.id },
  ],
  overlay: { [design.id]: "done", [api.id]: "open" },
  gaps: [],
};

const appSecond: FakePage = {
  participants: [acme, app, web],
  activities: [ship, ui],
  transitions: [blocks(api, ship), blocks(ui, ship), blocks(api, ui)],
  relations: [],
  overlay: { [ship.id]: "open", [ui.id]: "open" },
  gaps: [],
};

const webOnly: FakePage = {
  participants: [acme, web],
  activities: [ui],
  transitions: [],
  relations: [{ kind: "part-of", from: web.id, to: acme.id }],
  overlay: { [ui.id]: "open" },
  gaps: [],
};

/**
 * Issues in two repositories of one organisation, shaped the way the GitHub issues source reports them: `acme/app` spans two pages and its last issue waits on work in `acme/web`, which waits on the API. Any other `github:` scope is a `not-found` gap.
 */
export const githubLikeSource: FakeGraphSourceOptions = {
  source: "github",
  scopes: {
    "github:acme/app": [appFirst, appSecond],
    "github:acme/web": [webOnly],
  },
};

/** The identifiers of the fixture's issues, for assertions. */
export const issues = {
  design: design.id,
  api: api.id,
  ship: ship.id,
  ui: ui.id,
} as const;
