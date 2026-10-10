import { expect, test } from "vitest";
// Deliberately imports the built dist/, not src/: this is the check that catches a wrong exports map or a build misconfiguration that a unit test importing straight from src/ never touches.
import { connectGraphStore } from "../dist/index.js";

test("the built page entry exports the client factory", () => {
  expect(typeof connectGraphStore).toBe("function");
});
