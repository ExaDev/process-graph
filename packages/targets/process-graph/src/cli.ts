// The `process-graph/cli` entry point: the command line as a library. `runCli` runs the whole command surface against injected ports, `nodePorts` wires those ports for a Node process, and the operations behind each command and the Mermaid and DOT emitters return plain data. Node-only, which is why the root entry point does not carry it.
export * from "@exadev/process-graph-cli";
