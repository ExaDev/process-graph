# @exadev/process-graph-web

[![GitHub](https://img.shields.io/badge/GitHub-181717?logo=github&logoColor=white)](https://github.com/ExaDev/process-graph) [![CI](https://img.shields.io/github/actions/workflow/status/ExaDev/process-graph/ci.yml?branch=main)](https://github.com/ExaDev/process-graph/actions)

The process-graph web app: an installable, offline-first PWA that syncs GitHub issues from any number of organisations and repositories into a SQLite store on the device and shows the work as a flowchart, swimlane, state machine or sequence diagram, with what is ready, what is blocked, what each piece of work holds up and why each has its status. It is a composition root and nothing else: the model, reasoning, projections, layout, source, store and components are the other packages of this repository, wired together in `src/main.tsx` through `AppPorts`. A private workspace package; it is deployed, not published.

React 19, Vite, Vanilla Extract over graph-ui's theme contract, vite-plugin-pwa (Workbox).

## Screens

| Screen  | What it does                                                                                                                                                                                                                                                                              |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Token   | Takes a GitHub token, says what it needs (read-only Issues and Metadata on a fine-grained token, or a classic token with no scopes for public repositories and `repo` for private ones) and where it goes. The field is write-only; a saved token is never shown again.                   |
| Scope   | Any number of scopes: `owner`, `owner/repo`, a source-qualified scope such as `github:owner/repo`, or a pasted GitHub link.                                                                                                                                                               |
| Sync    | Reads the scopes page by page and writes each page as it is read, announcing progress. Cancelling stops it between or during reads; a cancelled, rate-limited or interrupted sync resumes from its checkpoint, which is kept on the device so it survives a reload.                       |
| View    | The model as a flowchart, swimlane, state machine or sequence diagram (`ProcessView` from graph-react-flow), filtered, with the critical path marked and a legend. A state machine follows an entity; a sequence follows the model's own scenario, else the critical path.                |
| Lists   | Ready, blocked (with what each waits on), the critical path, hand-offs between owners, cycles and structural problems: the command line's `ready`, `blocked`, `path`, `handoffs`, `cycles` and `validate`.                                                                                |
| Details | The selected element's status and the rule that decided it, its blockers and what it holds up (`why`, `blocked`, `impact`), its issue on GitHub, buttons that set its run state (`set`), and, for an issue in a repository outside the scope, one that adds that repository and syncs it. |
| Filters | Status, actor and source collection, as graph-ui's `FilterPanel`; the view and the lists follow them.                                                                                                                                                                                     |
| Add     | Adds a participant, activity, decision, state, event, artefact or transition by hand, as the command line's `add` does; the store refuses a change that would leave the model invalid.                                                                                                    |
| Notices | Offline; a new version ready to load; parts of the link that could not be used; a sync that stopped (a rate limit with its reset time, a token GitHub refused, anything else); and the parts of the scope the source could not read.                                                      |

The theme follows the system's colour scheme until a person picks light or dark. Every list and the canvas move their selection with the arrow keys, Home, End and Escape, the view and list tabs with the arrow keys, Home and End, and a skip link leads past the header.

## The address

The query string carries the view, so the address is always a link to what is on screen. A part at its default is left out, and a link that sets nothing opens the default view.

| Parameter             | Meaning                                                                     |
| --------------------- | --------------------------------------------------------------------------- |
| `scope` (repeatable)  | A source-qualified scope, in order.                                         |
| `view`                | `flowchart`, `swimlane` (the default), `state` or `sequence`.               |
| `list`                | `ready` (the default), `blocked`, `path`, `handoffs`, `cycles` or `issues`. |
| `select`              | The selected element's identifier.                                          |
| `status` (repeatable) | A status to show: `done`, `unknown`, `skipped`, `ready`, `blocked`.         |
| `actor` (repeatable)  | A participant whose work to show.                                           |
| `source` (repeatable) | A source collection whose work to show, such as `github:owner/repo`.        |
| `subject`             | The entity a state machine follows.                                         |
| `step` (repeatable)   | A transition a sequence diagram follows, in order.                          |

A value the app cannot use is left out and named in a notice. The scopes, sorted, name the model in the store, so the same scopes in any order are the same model, and someone opening a link reads its scopes into their own store.

## Data and privacy

The store is graph-sqlite-wasm: SQLite in a dedicated worker on the origin private file system, shared by every tab under a Web Lock, with each tab hearing the others' writes. It needs no `Cross-Origin-Opener-Policy` or `Cross-Origin-Embedder-Policy` headers, and neither the dev server nor the preview server sets them.

The GitHub source runs in the page through the source contract's in-process oRPC client. The token is kept in the origin's local storage on this device. It is read when a sync starts, handed to the source's token port and sent only in the `Authorization` header of requests to `api.github.com`; it is never logged, shown or put in React state. The device also keeps each model's last sync record (its checkpoint and gaps) and the theme preference.

## Offline and updates

The service worker precaches the app shell: the page, scripts, styles, icons and the SQLite wasm. The model is read from the origin private file system, so the last sync renders offline and a reload offline works; syncing waits for the network. A new version of the service worker waits until the person chooses to reload into it from the notice, so a running sync is never cut short.

## Building

`pnpm build` runs `vite build`. `build/icons.ts` renders the icons at build time: one SVG glyph in the theme contract's colours, rasterised by resvg to the 192 and 512 pixel PNGs, `any` and `maskable`, that Chromium's install criteria ask for, and emitted into the bundle, so no generated image is committed. The manifest's theme and background colours come from graph-ui's theme values. `GRAPH_WEB_BASE` sets the base path the app is served under, such as `/process-graph/`; the manifest's `start_url` and `scope` follow it.

## Tests

The screen tests render the app with Testing Library in happy-dom against the store contract's in-memory fake and the source contract's fake source, each through its oRPC client, laid out by a stub engine. `test/app.smoke.test.ts` checks the built `dist/`: the manifest, the rendered icons and the precache.

The end-to-end tests run Playwright in Chromium against `vite preview` of the production build. A local fixture server stands in for GitHub's GraphQL API; the browser's requests to `api.github.com` are routed to it, so the browser still addresses GitHub. They sync organisations and see the graph and lists, check that the token reaches no host but `api.github.com`, check installability (Chromium's own installability report, the manifest and an active service worker) and the absence of cross-origin isolation, reload offline and see the last sync, set a run state in one tab and see it in another, expand the scope on demand, and see a rate limit's reset time.

## Commands

```sh
pnpm build          # vite build -> dist/
pnpm dev            # the Vite dev server
pnpm preview        # the production build, served as a static host would
pnpm test           # screen and unit tests in happy-dom
pnpm test:smoke     # the built dist/
pnpm test:e2e       # Playwright against the production build (after pnpm build)
```
