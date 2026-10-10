import type { FakeGraphSourceOptions } from "../fake.ts";

const org = { id: "fake:acme", label: "acme", kind: "system" } as const;
const alpha = {
  id: "fake:acme/alpha",
  label: "acme/alpha",
  kind: "system",
} as const;
const beta = {
  id: "fake:acme/beta",
  label: "acme/beta",
  kind: "system",
} as const;
const ada = { id: "fake:@ada", label: "ada", kind: "role" } as const;

const activity = (
  repo: typeof alpha | typeof beta,
  number: string,
  label: string,
) => {
  const id = `${repo.id}#${number}`;

  return { kind: "activity", id, source: id, label, actor: repo.id } as const;
};

/** Two repositories of one organisation: alpha spans two pages, beta one, and beta's work waits on alpha's. */
export const fakeOptions: FakeGraphSourceOptions = {
  source: "fake",
  scopes: {
    "fake:acme/alpha": [
      {
        participants: [org, alpha, ada],
        activities: [
          activity(alpha, "1", "Design the schema"),
          activity(alpha, "2", "Build the store"),
        ],
        transitions: [
          {
            id: "fake:acme/alpha#1->fake:acme/alpha#2",
            source: "fake:acme/alpha#1",
            target: "fake:acme/alpha#2",
          },
        ],
        relations: [
          { kind: "part-of", from: alpha.id, to: org.id },
          { kind: "assigned-to", from: "fake:acme/alpha#1", to: ada.id },
        ],
        overlay: { "fake:acme/alpha#1": "done", "fake:acme/alpha#2": "open" },
        gaps: [],
      },
      {
        participants: [org, alpha],
        activities: [activity(alpha, "3", "Document the store")],
        transitions: [],
        relations: [
          { kind: "part-of", from: alpha.id, to: org.id },
          {
            kind: "child-of",
            from: "fake:acme/alpha#3",
            to: "fake:acme/alpha#2",
          },
        ],
        overlay: { "fake:acme/alpha#3": "open" },
        gaps: [],
      },
    ],
    "fake:acme/beta": [
      {
        participants: [org, alpha, beta],
        activities: [
          activity(beta, "1", "Ship the client"),
          activity(alpha, "2", "Build the store"),
        ],
        transitions: [
          {
            id: "fake:acme/alpha#2->fake:acme/beta#1",
            source: "fake:acme/alpha#2",
            target: "fake:acme/beta#1",
          },
        ],
        relations: [
          { kind: "part-of", from: beta.id, to: org.id },
          { kind: "part-of", from: alpha.id, to: org.id },
        ],
        overlay: { "fake:acme/beta#1": "open", "fake:acme/alpha#2": "open" },
        gaps: [],
      },
    ],
  },
};
