// The `process-graph/sync` entry point: `syncScopes`, which syncs `GraphSource`s into a `GraphStore` page by page, relations included, resumable from a checkpoint and narrowed by a typed filter. The command line and the web app both sync through it. It takes the source and store clients it is given, so it runs unchanged in a browser, a Worker or Node.
export * from "@exadev/process-graph-sync";
