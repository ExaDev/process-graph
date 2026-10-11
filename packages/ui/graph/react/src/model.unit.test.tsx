import {
  createFakeGraphStore,
  createGraphStoreRouter,
} from "@exadev/process-graph-store-contract";
import { createRouterClient } from "@orpc/server";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, test } from "vitest";
import { useModel } from "./model.ts";
import { order } from "./test-support/order.ts";

afterEach(cleanup);

const storeWithOrder = async () => {
  const client = createRouterClient(
    createGraphStoreRouter(createFakeGraphStore()),
  );
  await client.v1.models.save({ modelId: "order", model: order });

  return client;
};

describe("useModel", () => {
  test("loads the model with its overlay and revision", async () => {
    const client = await storeWithOrder();
    const { result } = renderHook(() => useModel(client, "order"));

    expect(result.current).toEqual({ status: "loading" });
    await waitFor(() => {
      expect(result.current.status).toBe("loaded");
    });
    if (result.current.status !== "loaded") {
      throw new Error("expected a loaded model");
    }
    expect(result.current.stored.model.elements.map((e) => e.id)).toEqual(
      order.elements.map((e) => e.id),
    );
    expect(result.current.stored.overlay).toEqual({});
  });

  test("follows later changes to the model's run state", async () => {
    const client = await storeWithOrder();
    const { result } = renderHook(() => useModel(client, "order"));
    await waitFor(() => {
      expect(result.current.status).toBe("loaded");
    });

    const { revision } = await client.v1.overlay.set({
      modelId: "order",
      overlay: { "a-submit": "done" },
    });

    await waitFor(() => {
      expect(result.current).toMatchObject({
        status: "loaded",
        stored: { revision, overlay: { "a-submit": "done" } },
      });
    });
  });

  test("fails when the model is deleted", async () => {
    const client = await storeWithOrder();
    const { result } = renderHook(() => useModel(client, "order"));
    await waitFor(() => {
      expect(result.current.status).toBe("loaded");
    });

    await client.v1.models.delete({ modelId: "order" });

    await waitFor(() => {
      expect(result.current.status).toBe("failed");
    });
  });

  test("fails for a model the store does not have", async () => {
    const client = await storeWithOrder();
    const { result } = renderHook(() => useModel(client, "missing"));

    await waitFor(() => {
      expect(result.current.status).toBe("failed");
    });
  });

  test("starts loading again when the model id changes", async () => {
    const client = await storeWithOrder();
    await client.v1.models.save({ modelId: "copy", model: order });
    const { result, rerender } = renderHook(
      ({ modelId }) => useModel(client, modelId),
      { initialProps: { modelId: "order" } },
    );
    await waitFor(() => {
      expect(result.current.status).toBe("loaded");
    });

    rerender({ modelId: "copy" });
    expect(result.current).toEqual({ status: "loading" });
    await waitFor(() => {
      expect(result.current).toMatchObject({
        status: "loaded",
        stored: { modelId: "copy" },
      });
    });
  });
});
