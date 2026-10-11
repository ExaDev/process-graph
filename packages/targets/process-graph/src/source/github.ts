// The `process-graph/source/github` entry point: the `GraphSource` port (its oRPC contract, schemas, errors, router, pagination and in-memory fake) and the GitHub issues adapter that implements it. The adapter's token comes from an injected port; the Node token helper is `process-graph/source/github/node`, so this entry runs unchanged in a browser or a Worker. The two layers share no export name, which `entrypoints.unit.test.ts` checks.
export * from "@exadev/process-graph-source-contract";
export * from "@exadev/process-graph-source-github-issues";
