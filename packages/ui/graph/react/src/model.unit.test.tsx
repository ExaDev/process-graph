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

  test("shows a deleted model as missing and loads it again when it is saved", async () => {
    const client = await storeWithOrder();
    const { result } = renderHook(() => useModel(client, "order"));
    await waitFor(() => {
      expect(result.current.status).toBe("loaded");
    });

    await client.v1.models.delete({ modelId: "order" });

    await waitFor(() => {
      expect(result.current).toEqual({ status: "missing" });
    });

    const { revision } = await client.v1.models.save({
      modelId: "order",
      model: order,
    });

    await waitFor(() => {
      expect(result.current).toMatchObject({
        status: "loaded",
        stored: { revision },
      });
    });
  });

  test("follows a model the store does not have yet and loads it once it is created", async () => {
    const client = await storeWithOrder();
    const { result } = renderHook(() => useModel(client, "later"));

    await waitFor(() => {
      expect(result.current).toEqual({ status: "missing" });
    });

    const { revision } = await client.v1.items.upsert({
      modelId: "later",
      items: {
        participants: [],
        activities: [
          { kind: "activity", id: "s:a#1", label: "First", source: "s:a#1" },
        ],
        transitions: [],
        overlay: {},
      },
    });

    await waitFor(() => {
      expect(result.current).toMatchObject({
        status: "loaded",
        stored: { modelId: "later", revision },
      });
    });
  });

  test("fails with any error other than a missing model", async () => {
    const client = await storeWithOrder();
    const failing = {
      v1: {
        models: {
          load: async () => Promise.reject(new Error("the store is closed")),
        },
        changes: client.v1.changes,
      },
    };
    const { result } = renderHook(() => useModel(failing, "order"));

    await waitFor(() => {
      expect(result.current).toMatchObject({
        status: "failed",
        error: new Error("the store is closed"),
      });
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
