#!/usr/bin/env node
import { packageVersion, runProcess } from "./node.ts";

process.exitCode = await runProcess({
  name: "process-graph-cli",
  version: packageVersion(new URL("../package.json", import.meta.url)),
});
