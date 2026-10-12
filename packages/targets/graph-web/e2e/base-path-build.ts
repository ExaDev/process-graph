import { build, preview } from "vite";
import { basePath, basePathOutDir, basePathPreviewPort } from "./base-path.ts";

const configFile = new URL("../vite.config.ts", import.meta.url).pathname;

/**
 * Playwright's global setup: builds the app a second time with `GRAPH_WEB_BASE` set to the sub-path, into its own output directory, and previews it on its own port for the base-path end-to-end test. This is not a `webServer` entry because Playwright starts those before global setup, when the build does not exist yet. The variable is set on this process before Vite loads `vite.config.ts`, which reads it once.
 * @returns The teardown, which stops the preview server.
 */
export default async function serveAtBasePath(): Promise<() => Promise<void>> {
  process.env.GRAPH_WEB_BASE = basePath;
  await build({
    configFile,
    logLevel: "warn",
    build: { outDir: basePathOutDir, emptyOutDir: true },
  });
  const server = await preview({
    configFile,
    logLevel: "warn",
    build: { outDir: basePathOutDir },
    preview: {
      host: "127.0.0.1",
      port: basePathPreviewPort,
      strictPort: true,
    },
  });

  return async () => {
    await server.close();
  };
}
