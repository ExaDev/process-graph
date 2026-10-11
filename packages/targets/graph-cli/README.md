# @exadev/process-graph-cli

[![GitHub](https://img.shields.io/badge/GitHub-181717?logo=github&logoColor=white)](https://github.com/ExaDev/process-graph) [![CI](https://img.shields.io/github/actions/workflow/status/ExaDev/process-graph/ci.yml?branch=main)](https://github.com/ExaDev/process-graph/actions)

A private workspace package, not published on its own: it is bundled into [`process-graph`](../process-graph/README.md), which exposes it as `process-graph/cli`, and its command line is the `process-graph` bin.

The process-graph command line, and the same commands as a library. It syncs work from GitHub issues into a SQLite store, answers what is ready, blocked, affected, on the critical path or handed off between owners, explains why an element has its status, builds and edits a model by hand, and draws the model as a flowchart, swimlane, state machine or sequence diagram in Mermaid or Graphviz DOT.

It is a composition root and nothing else: the model, reasoning, projections, sources and store are the other packages of this repository, and this package wires them to a command line through injected ports. The unscoped [`process-graph`](../process-graph/README.md) package carries the same command line as its `process-graph` bin; this package's own bin is `process-graph-cli`.

```sh
process-graph sync github:ExaDev github:Mearman/agent-permissions
process-graph ready
process-graph why github:ExaDev/process-graph#12
process-graph show --view swimlane --format mermaid
```

## Commands

| Command                                                                              | What it does                                                                                                                                         |
| ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sync <scope...> [--after <cursor>]`                                                 | Reads the scopes from their sources and merges them into the model in one write; prints what it wrote and any gaps.                                  |
| `ready`                                                                              | The work that can start now.                                                                                                                         |
| `blocked <id>`                                                                       | The open work an element is waiting on: the ends of its blocked-by chain.                                                                            |
| `impact <id>`                                                                        | The live work that depends on an element.                                                                                                            |
| `path`                                                                               | The critical path: the longest chain of work still ahead, each element counting one step.                                                            |
| `cycles`                                                                             | The cycles no decision closes.                                                                                                                       |
| `handoffs`                                                                           | The transitions from one actor's work to another's, such as a dependency across repositories or organisations.                                       |
| `why <id>`                                                                           | The rule that decided an element's status, its needs and artefacts, and the blocked-by chain behind it.                                              |
| `show [--view <view>] [--format <format>]`                                           | Draws the model. Views: `flowchart` (default), `swimlane`, `state`, `sequence`. Formats: `mermaid` (default), `dot`, `json` (the projection itself). |
| `add participant <id> <label> [--kind <kind>]`                                       | Adds a `role` (default), `system` or `entity`.                                                                                                       |
| `add activity <id> <label> [--actor <participant>]`                                  | Adds a step of work.                                                                                                                                 |
| `add decision <id> <label> [--actor <participant>]`                                  | Adds a point where the flow branches.                                                                                                                |
| `add state <id> <label> [--parent <state>]`                                          | Adds a state an entity rests in.                                                                                                                     |
| `add event <id> <name>`                                                              | Adds an event that can trigger a transition.                                                                                                         |
| `add artefact <id> <name> [--deliverable]`                                           | Adds something activities consume or produce.                                                                                                        |
| `add transition <source> <target> [--id <id>] [--guard <label>] [--trigger <event>]` | Adds a transition; the target waits on the source. Its identifier defaults to `<source>-><target>`, the form sources use.                            |
| `set <id> <done\|open\|unknown>`                                                     | Sets an element's run state.                                                                                                                         |
| `validate [file]`                                                                    | Checks the stored model and run state, or a model document as JSON, for structural issues and illegal cycles.                                        |

`show --view state` follows an entity given with `--subject`, and `show --view sequence` follows the transitions given with `--scenario`; each defaults to the matching projection the model declares.

Every command takes the global options:

| Option          | Default                                            | Meaning                                                     |
| --------------- | -------------------------------------------------- | ----------------------------------------------------------- |
| `--data <path>` | `PROCESS_GRAPH_DATA`, else the XDG data file below | The SQLite file the store keeps. It is created when absent. |
| `--model <id>`  | `default`                                          | The model in the store; one file holds many.                |
| `--json`        | off                                                | Writes the result as JSON.                                  |

Without `--data` or `PROCESS_GRAPH_DATA`, the store is `process-graph/graph.sqlite3` under `XDG_DATA_HOME`, or under `~/.local/share` when that is not set.

The store holds synced work that other users on the host must not read. On Unix, the command line creates its default directory, and any missing directories above it, readable by its owner only (`0700`), and creates the database file the same way (`0600`) before SQLite opens it, so the `-wal` and `-shm` files SQLite derives from it are private too. A default store that already exists readable by others is narrowed to those modes, with one warning on standard error naming what changed. At a path given with `--data` or `PROCESS_GRAPH_DATA`, only a database file the command line creates is made private; the directory and an existing file are left as the user made them. Windows has no such modes, and nothing is set there.

## Output

Text output is stable and made for scripts: a list is one item per line with tab-separated fields (an element is its identifier and label), and an empty list prints nothing. `--json` writes the same result as one JSON document; for `show` it is the projection when the format is `json`, and otherwise the view, the format and the diagram text. Errors go to standard error as one message, with no stack trace.

Text from a source can carry characters that act on a terminal or change what it shows: escape sequences that clear the screen or set the clipboard, and characters that reorder, hide or misdraw text. Everything the command line writes, results, diagrams, help and errors alike, writes every character in the Unicode general categories `Cc` (controls), `Cf` (format characters, every bidirectional control included), `Zl` and `Zp` (line and paragraph separators), `Cn` (unassigned) and `Co` (private use) as a visible escape of its code point, `\u{1b}` for ESC or `\u{202e}` for a right-to-left override. Line feed and tab are kept, and so are the zero-width non-joiner and joiner, which emoji sequences and scripts such as Persian need; every other character, accented, CJK, Arabic and emoji included, is written as it is. In Mermaid and DOT the escape sits inside the label's own escaping, so the diagram stays valid. `--json` writes the same characters as JSON `\u` escapes, so the parsed values are exactly the source's.

The Mermaid emitters name nodes by their position in the view, since Mermaid does not accept identifiers such as `github:org/repo#12`, and write every character Mermaid reads as syntax in a label as its entity code. The DOT emitters keep the model identifiers as node names. Hand-offs are drawn as thick (Mermaid) or bold (DOT) edges, and an empty swimlane lane is still drawn. DOT has no sequence notation, so a sequence diagram in DOT is a grid of lifelines with one row per message, each message numbered and prefixed with the fragments around it.

## Exit status

| Status | Meaning                                                                                                                                                                   |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0      | Success; for `validate` and `cycles`, nothing wrong was found.                                                                                                            |
| 1      | A failure not listed below, such as a store that cannot be opened.                                                                                                        |
| 2      | A usage error: an unknown command or option, a missing argument, a value outside its choices, or a view with nothing to follow.                                           |
| 3      | The model, an element or another identifier named on the command line does not exist.                                                                                     |
| 4      | The model has problems: `validate` found issues, `cycles` found one, a reasoning command met an illegal cycle, or the store rejected a change.                            |
| 5      | A source refused the sync: credentials, a rate limit or a scope it does not accept.                                                                                       |
| 6      | The `process-graph` bin could not start: optional peer dependencies the command line needs are not installed beside it. It names them and the command that installs them. |

## Sources and tokens

Scopes are source-qualified: `github:owner` reads every repository an account owns and `github:owner/repo` one repository. The GitHub token comes from `GITHUB_TOKEN`, or from the GitHub CLI (`gh auth token`) when that is not set; it is sent only to GitHub and never printed.

A sync merges everything it reads into the model in one write, so a record synced again is replaced by identifier and the rest of the model is kept. When a source fails part way, as on a rate limit, the pages read before the failure are still written and the error prints the command that resumes the sync with `--after`. Relations a source reports (sub-issues, assignees, repository membership) have no place in the store and are not kept.

## Library

`runCli(args, ports, identity)` runs the whole command surface as a function and resolves with the exit status; it never reads `process.argv`, writes to the process's streams or exits. `CliPorts` is everything it touches: `stdout` and `stderr`, `openStore(path)` (any `GraphStoreClient`, over any transport), `defaultDataPath`, `source(prefix)` (any `GraphSourceClient`), `readFile`, the `facts` decision conditions read, and the abort `signal`. `nodePorts(options)` builds them for a Node process, with the environment, home directory, GitHub token port, `fetch`, clock, facts, signal and streams each replaceable; `runProcess(identity)` is what the bins run.

A host program imports the library from `process-graph/cli` and mounts the command line as a subcommand by forwarding its arguments:

```ts
import { nodePorts, packageVersion, runCli } from "process-graph/cli";

// sb graph <args...>
process.exitCode = await runCli(args, nodePorts(), {
  name: "sb graph",
  version: packageVersion(new URL("../package.json", import.meta.url)),
});
```

The operation behind each command is exported on its own and returns plain data rather than text, for hosts that want results, such as tools served over MCP: `sync`, `ready`, `blocked`, `impactOf`, `path`, `cycles`, `handoffsOf`, `why`, `show`, `add`, `setState`, `validateStored` and `validateDocument`, each taking a `GraphSession` (a store client, a model id, facts and a signal). The emitters `flowchartToMermaid`, `swimlaneToMermaid`, `stateMachineToMermaid`, `sequenceToMermaid` and their `...ToDot` counterparts are pure functions of a projection.

`add` reads the model and saves it whole, so a write another process makes between the two is overwritten; the store checks every save, so a duplicate identifier or a dangling reference is rejected and nothing changes.

## Commands

```sh
pnpm build          # tsc -b -> dist/ (ESM + .d.ts), including the bin
pnpm test           # unit tests, end to end against an in-memory source and a SQLite file
pnpm test:smoke     # the built dist/ as a library and the built bin as a process
pnpm test:mutation  # Stryker
```
