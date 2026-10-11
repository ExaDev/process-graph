import { join } from "node:path";
import ts from "typescript";
import { expect, test } from "vitest";

/** A consumer's module that embeds `modelSchema` in a schema of its own and exports it, so its declaration file has to write the schema's type. */
const consumerSource = `import { z } from "zod";
import { modelSchema } from "./index.ts";

export const envelope = z.object({ model: modelSchema });
`;

/**
 * Emits the declaration file of a module beside this package's source, as a consumer compiling with `declaration: true` would.
 * @param source - The module's source.
 * @returns The emitted declaration file and every diagnostic the program and the emit reported, as `TS<code>: <message>`.
 */
const declarationsOf = (
  source: string,
): {
  readonly declarations: string;
  readonly diagnostics: readonly string[];
} => {
  const file = join(import.meta.dirname, "declaration-emit.consumer.ts");
  const options: ts.CompilerOptions = {
    declaration: true,
    emitDeclarationOnly: true,
    strict: true,
    exactOptionalPropertyTypes: true,
    allowImportingTsExtensions: true,
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    target: ts.ScriptTarget.ES2024,
    skipLibCheck: true,
  };
  const host = ts.createCompilerHost(options);
  const getSourceFile = host.getSourceFile.bind(host);
  const fileExists = host.fileExists.bind(host);
  host.getSourceFile = (name, languageVersion, ...rest) =>
    name === file
      ? ts.createSourceFile(name, source, languageVersion)
      : getSourceFile(name, languageVersion, ...rest);
  host.fileExists = (name) => name === file || fileExists(name);
  let declarations = "";
  host.writeFile = (name, text) => {
    if (name.endsWith("declaration-emit.consumer.d.ts")) {
      declarations = text;
    }
  };
  const program = ts.createProgram([file], options, host);
  const consumer = program.getSourceFile(file);
  const emitted = program.emit(consumer);
  const diagnostics = [
    ...ts.getPreEmitDiagnostics(program, consumer),
    ...emitted.diagnostics,
  ].map(
    (diagnostic) =>
      `TS${String(diagnostic.code)}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n")}`,
  );

  return { declarations, diagnostics };
};

/** No per-test time limit: the test builds a whole TypeScript program over this package and zod's declarations, so how long it takes is the compiler's work on the machine at hand, not a property of this code, and a clock bound only fails it under load or coverage instrumentation. The CI job's own timeout still ends a hang. */
const unbounded = 0;

test(
  "a consumer's schema embedding modelSchema emits declarations that name ModelSchema rather than writing it out",
  { timeout: unbounded },
  () => {
    const { declarations, diagnostics } = declarationsOf(consumerSource);

    expect(diagnostics).toEqual([]);
    expect(declarations).toMatch(/model: import\("[^"]+"\)\.ModelSchema;/);
    expect(declarations).not.toContain("participants");
  },
);
