/** The sub-path a project site serves the app under (`https://<owner>.github.io/process-graph/`), which the base-path build and its tests use. */
export const basePath = "/process-graph/";

/** Where the base-path build is written, beside `dist/` so it never disturbs the root build the other end-to-end tests serve. */
export const basePathOutDir = "dist-base-path";

/** The port the base-path build is previewed on, pinned with `--strictPort` like the root build's. */
export const basePathPreviewPort = 4174;
