import {
  createFakeGraphStore,
  createGraphStoreRouter,
} from "@exadev/process-graph-store-contract";
import { createRouterClient } from "@orpc/server";
import type {
  AppPorts,
  AppUpdates,
  ThemePreference,
  ThemePreferenceStore,
  TokenStore,
  SyncRecords,
} from "./ports.ts";
import type { SyncRecord } from "./sync-record.ts";

/** The suffix of the hostnames GitHub Pages serves every account's and organisation's sites from. */
const sharedPagesSuffix = ".github.io";

/**
 * Whether the app may keep anything on the device for the origin it runs on. Every page under one `github.io` hostname shares an origin, and URL paths do not partition `localStorage`, IndexedDB or the origin private file system, so any other page there could read a saved token and the synced issues. On such an origin the app keeps nothing.
 * @param location - The page's location, of which only the hostname is read.
 * @returns False on a shared GitHub Pages origin, true anywhere else (localhost, an origin of one's own).
 */
export const persistenceAllowed = (
  location: Readonly<Pick<Location, "hostname">>,
): boolean => !location.hostname.toLowerCase().endsWith(sharedPagesSuffix);

/** The ports that decide what outlives the page, as the ephemeral mode supplies them. */
export type PersistencePorts = Pick<
  AppPorts,
  "store" | "token" | "syncRecords" | "themePreference" | "updates"
>;

/**
 * Ports that hold everything in this page's memory and touch no storage: the token and the theme preference are variables, sync records a map, the store the store contract's in-memory fake, and there is no service worker and so never an update. All of it is gone when the page is.
 * @returns The ports.
 */
export const ephemeralPersistence = (): PersistencePorts => {
  let token: string | undefined;
  let preference: ThemePreference = "system";
  const records = new Map<string, SyncRecord>();

  const tokens: TokenStore = {
    read: () => token,
    write: (next) => {
      token = next;
    },
    clear: () => {
      token = undefined;
    },
  };
  const syncRecords: SyncRecords = {
    read: (modelId) => records.get(modelId),
    write: (record) => {
      records.set(record.modelId, record);
    },
  };
  const themePreference: ThemePreferenceStore = {
    read: () => preference,
    write: (next) => {
      preference = next;
    },
  };
  const updates: AppUpdates = {
    available: { get: () => false, subscribe: () => () => undefined },
    apply: () => undefined,
  };

  return {
    store: createRouterClient(createGraphStoreRouter(createFakeGraphStore())),
    token: tokens,
    syncRecords,
    themePreference,
    updates,
  };
};
