import {
  createFakeGraphSource,
  GraphSourceError,
  type FakePage,
  type GraphSourcePager,
} from "@exadev/process-graph-source-contract";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { exitCodes } from "./exit-codes.ts";
import { githubLikeSource, issues } from "./test-support/fixtures.ts";
import { createHarness, type Harness } from "./test-support/harness.ts";

const { design, api, ship, ui } = issues;

let harness: Harness;

beforeEach(() => {
  harness = createHarness();
});

afterEach(() => {
  harness.remove();
});

const syncFixture = async () =>
  harness.run("sync", "github:acme/app", "github:acme/web");

describe("sync", () => {
  test("merges every page of every scope into the model and reports what it wrote", async () => {
    const result = await harness.run(
      "sync",
      "github:acme/app",
      "github:acme/web",
      "github:acme/missing",
    );

    expect(result).toEqual({
      code: exitCodes.success,
      stdout:
        'synced 4 activities, 4 transitions, 3 relations and 4 participants into "default" at revision 4\n' +
        "gap\tnot-found\tgithub:acme/missing\tgithub:acme/missing does not exist\n",
      stderr: "",
    });
  });

  test("writes JSON with --json", async () => {
    const result = await harness.run("sync", "github:acme/app", "--json");

    expect(JSON.parse(result.stdout)).toEqual({
      modelId: "default",
      revision: 2,
      participants: 4,
      activities: 4,
      transitions: 4,
      relations: 2,
      gaps: [],
    });
  });

  test("refreshes the model by identifier when synced again", async () => {
    await syncFixture();
    const again = await harness.run("sync", "github:acme/web");

    expect(again.stdout).toBe(
      'synced 1 activities, 0 transitions, 1 relations and 2 participants into "default" at revision 4\n',
    );
    expect((await harness.run("ready")).stdout).toBe(`${api}\tBuild the API\n`);
  });

  test("refuses --after with the scopes of more than one source", async () => {
    harness.remove();
    harness = createHarness(
      createFakeGraphSource(githubLikeSource),
      createFakeGraphSource({ source: "jira", scopes: { "jira:ACME": [] } }),
    );

    expect(
      await harness.run("sync", "github:acme/app", "jira:ACME", "--after", "x"),
    ).toEqual({
      code: exitCodes.usage,
      stdout: "",
      stderr:
        "--after resumes one source's sync: give only that source's scopes\n",
    });
  });

  test("rejects a scope with no source prefix, and a prefix no source reads, as usage errors", async () => {
    const bare = await harness.run("sync", "acme/app");
    const jira = await harness.run("sync", "jira:ACME");

    expect(bare.code).toBe(exitCodes.usage);
    expect(bare.stderr).toBe(
      '"acme/app" is not a scope: write <source>:<scope>, such as github:owner/repo\n',
    );
    expect(jira.code).toBe(exitCodes.usage);
    expect(jira.stderr).toBe('no source reads "jira" scopes\n');
  });

  test("reports a cursor the source did not issue as a source failure", async () => {
    const result = await harness.run(
      "sync",
      "github:acme/app",
      "--after",
      "bogus",
    );

    expect(result.code).toBe(exitCodes.sourceFailure);
    expect(result.stderr).toBe(
      '"bogus" is not a cursor for this scope\n' +
        "resume with: sync github:acme/app --after bogus\n",
    );
  });

  test("saves the pages read before a source fails and says how to resume", async () => {
    const fake = createFakeGraphSource(githubLikeSource);
    let reads = 0;
    const failing: GraphSourcePager = {
      source: fake.source,
      page: async (request) => {
        reads += 1;
        if (reads > 1) {
          throw new GraphSourceError({
            kind: "rate-limited",
            message: "rate limited",
            resetAt: undefined,
          });
        }

        return fake.page(request);
      },
    };
    harness.remove();
    harness = createHarness(
      failing,
      createFakeGraphSource({ source: "jira", scopes: { "jira:ACME": [] } }),
    );

    const result = await harness.run(
      "sync",
      "github:acme/app",
      "jira:ACME",
      "github:acme/web",
    );

    expect(result.code).toBe(exitCodes.sourceFailure);
    expect(result.stderr).toBe(
      "rate limited\n" +
        "the pages read before the failure are saved\n" +
        "resume with: sync github:acme/app github:acme/web --after github%3Aacme%2Fapp@0\n" +
        "then: sync jira:ACME\n",
    );
    expect((await harness.run("ready")).stdout).toBe(`${api}\tBuild the API\n`);
  });
});

describe("hierarchy", () => {
  const epic = {
    kind: "activity",
    id: "github:acme/app#10",
    source: "github:acme/app#10",
    label: "Launch",
    actor: "github:acme/app",
  } as const;
  const task = (number: string, label: string) =>
    ({
      kind: "activity",
      id: `github:acme/app#${number}`,
      source: `github:acme/app#${number}`,
      label,
      actor: "github:acme/app",
    }) as const;
  const story = task("11", "Sign-up flow");
  const subtask = task("12", "Validate the email");
  // The sub-task arrives a page before its parent, as a sub-issue in another repository can.
  const pages: readonly FakePage[] = [
    {
      participants: [
        { id: "github:acme/app", label: "acme/app", kind: "system" },
      ],
      activities: [subtask],
      transitions: [],
      relations: [{ kind: "child-of", from: subtask.id, to: story.id }],
      overlay: { [subtask.id]: "open" },
      gaps: [],
    },
    {
      participants: [
        { id: "github:acme/app", label: "acme/app", kind: "system" },
      ],
      activities: [epic, story],
      transitions: [],
      relations: [{ kind: "child-of", from: story.id, to: epic.id }],
      overlay: { [epic.id]: "open", [story.id]: "open" },
      gaps: [],
    },
  ];

  beforeEach(async () => {
    harness.remove();
    harness = createHarness(
      createFakeGraphSource({
        source: "github",
        scopes: { "github:acme/app": pages },
      }),
    );
    await harness.run("sync", "github:acme/app");
  });

  test("children lists an element's sub-tasks from the relations sync kept", async () => {
    expect(await harness.run("children", epic.id)).toEqual({
      code: exitCodes.success,
      stdout: `${story.id}\tSign-up flow\n`,
      stderr: "",
    });
    expect((await harness.run("children", subtask.id)).stdout).toBe("");
  });

  test("ancestors lists what an element is a sub-task of, nearest first, with the distance", async () => {
    expect((await harness.run("ancestors", subtask.id)).stdout).toBe(
      `${story.id}\tSign-up flow\t1\n${epic.id}\tLaunch\t2\n`,
    );
    expect(
      JSON.parse((await harness.run("ancestors", subtask.id, "--json")).stdout),
    ).toEqual({
      element: { id: subtask.id, label: "Validate the email" },
      ancestors: [
        { id: story.id, label: "Sign-up flow", distance: 1 },
        { id: epic.id, label: "Launch", distance: 2 },
      ],
    });
  });

  test.each(["children", "ancestors"])(
    "%s of an element the model lacks is not found",
    async (command) => {
      expect(await harness.run(command, "github:acme/app#99")).toEqual({
        code: exitCodes.notFound,
        stdout: "",
        stderr: 'no element "github:acme/app#99" in the model\n',
      });
    },
  );
});

describe("reasoning over a synced model", () => {
  beforeEach(async () => {
    await syncFixture();
  });

  test("ready lists the work that can start now", async () => {
    expect(await harness.run("ready")).toEqual({
      code: exitCodes.success,
      stdout: `${api}\tBuild the API\n`,
      stderr: "",
    });
    expect(JSON.parse((await harness.run("ready", "--json")).stdout)).toEqual({
      elements: [{ id: api, label: "Build the API" }],
    });
  });

  test("blocked lists the open work at the end of the blocked-by chain", async () => {
    expect((await harness.run("blocked", ship)).stdout).toBe(
      `${api}\tBuild the API\n`,
    );
    expect(
      JSON.parse((await harness.run("blocked", ship, "--json")).stdout),
    ).toEqual({
      element: { id: ship, label: "Ship it", status: "blocked" },
      blockedBy: [{ id: api, label: "Build the API" }],
    });
    expect((await harness.run("blocked", api)).stdout).toBe("");
  });

  test("impact lists the live work that depends on an element, in model order", async () => {
    expect((await harness.run("impact", api)).stdout).toBe(
      `${ship}\tShip it\n${ui}\tBuild the UI\n`,
    );
    expect((await harness.run("impact", ship)).stdout).toBe("");
  });

  test("handoffs lists the transitions that cross from one repository to another", async () => {
    expect((await harness.run("handoffs")).stdout).toBe(
      `${ui}->${ship}\tgithub:acme/web -> github:acme/app\n` +
        `${api}->${ui}\tgithub:acme/app -> github:acme/web\n`,
    );
  });

  test("path lists the longest chain of work still ahead", async () => {
    expect((await harness.run("path")).stdout).toBe(
      `${api}\tBuild the API\n${ui}\tBuild the UI\n${ship}\tShip it\n`,
    );
    expect(
      JSON.parse((await harness.run("path", "--json")).stdout),
    ).toMatchObject({
      weight: 3,
    });
  });

  test("cycles finds none and succeeds", async () => {
    expect(await harness.run("cycles")).toEqual({
      code: exitCodes.success,
      stdout: "",
      stderr: "",
    });
    expect(JSON.parse((await harness.run("cycles", "--json")).stdout)).toEqual({
      cycles: [],
    });
  });

  test("why explains a blocked element with its needs and blocked-by chain", async () => {
    expect((await harness.run("why", ship)).stdout).toBe(
      [
        `${ship} is blocked: it waits on work that is not done`,
        "needs:",
        `  ${api} (ready) through ${api}->${ship}`,
        `  ${ui} (blocked) through ${ui}->${ship}`,
        "blocked-by chain:",
        `  ${ship} (blocked) waits on ${api}, ${ui}`,
        `  ${api} (ready)`,
        `  ${ui} (blocked) waits on ${api}`,
        "",
      ].join("\n"),
    );
  });

  test("why explains a ready and a done element by their rule alone", async () => {
    expect((await harness.run("why", design)).stdout).toBe(
      `${design} is done: its run state is done\n`,
    );
    expect((await harness.run("why", api)).stdout).toBe(
      [
        `${api} is ready: everything it needs is done`,
        "needs:",
        `  ${design} (done) through ${design}->${api}`,
        "",
      ].join("\n"),
    );
  });

  test("set changes an element's run state and the reasoning follows it", async () => {
    expect((await harness.run("set", api, "done")).stdout).toBe(
      `set ${api} to done at revision 4\n`,
    );
    expect((await harness.run("ready")).stdout).toBe(`${ui}\tBuild the UI\n`);
  });

  test("validate finds nothing wrong with a synced model", async () => {
    expect(await harness.run("validate")).toEqual({
      code: exitCodes.success,
      stdout: "valid\n",
      stderr: "",
    });
  });

  test.each(["blocked", "impact", "why"])(
    "%s of an element the model lacks is not found",
    async (command) => {
      expect(await harness.run(command, "github:acme/app#99")).toEqual({
        code: exitCodes.notFound,
        stdout: "",
        stderr: 'no element "github:acme/app#99" in the model\n',
      });
    },
  );

  test("set of an element the model lacks is not found", async () => {
    expect((await harness.run("set", "github:acme/app#99", "done")).code).toBe(
      exitCodes.notFound,
    );
  });
});

describe("a model that does not exist", () => {
  test.each([
    ["ready"],
    ["path"],
    ["cycles"],
    ["handoffs"],
    ["validate"],
    ["show"],
  ])("is not found by %s", async (command) => {
    expect(await harness.run(command, "--model", "absent")).toEqual({
      code: exitCodes.notFound,
      stdout: "",
      stderr: 'no model "absent" in the store; sync or add something first\n',
    });
  });
});
