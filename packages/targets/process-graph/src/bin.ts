#!/usr/bin/env node
import { packageVersion, runProcess } from "@exadev/process-graph-cli";

process.exitCode = await runProcess({
  name: "process-graph",
  version: packageVersion(new URL("../package.json", import.meta.url)),
});
