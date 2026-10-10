// The primary entry point: the model, its projections and its reasoning under one install. The schema, projection and domain packages are re-exported flat. The DAG package is namespaced as `dag` because its `criticalPath` has the same name as the domain package's, which answers a different question over the model and a run overlay. The whole layer is namespaced, not only the colliding name, so the rule is one sentence and a name added to a layer later cannot start colliding silently: TypeScript rejects a duplicate `export *` name and `index.unit.test.ts` checks the runtime surface against each package's own exports.
export * from "@exadev/process-graph-schema";
export * from "@exadev/process-graph-projection";
export * from "@exadev/process-graph-domain";
export * as dag from "@exadev/process-graph-dag";
