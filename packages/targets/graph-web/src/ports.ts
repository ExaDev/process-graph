import type { FlowLayoutOptions } from "@exadev/process-graph-react-flow";
import type { GraphStoreClient } from "@exadev/process-graph-store-contract";
import type { SyncRecord } from "./sync-record.ts";
import type { SourceLookup } from "@exadev/process-graph-sync";

/** A value that changes over time and tells its listeners when it does, in the shape React's `useSyncExternalStore` reads. */
export interface Observable<T> {
  readonly get: () => T;
  /** Registers a listener and returns the function that removes it. */
  readonly subscribe: (listener: () => void) => () => void;
}

/** The GitHub token kept on this device. It is read only to build the GitHub source, and never shown or logged. */
export interface TokenStore {
  readonly read: () => string | undefined;
  readonly write: (token: string) => void;
  readonly clear: () => void;
}

/** The record of each model's last sync, kept on this device so an interrupted sync resumes after a reload. */
export interface SyncRecords {
  readonly read: (modelId: string) => SyncRecord | undefined;
  readonly write: (record: SyncRecord) => void;
}

/** Which theme a person chose: the system's, or one of the two always. */
export type ThemePreference = "system" | "light" | "dark";

/** The theme preference, kept on this device. */
export interface ThemePreferenceStore {
  readonly read: () => ThemePreference;
  readonly write: (preference: ThemePreference) => void;
}

/** The page address's query string, which carries the view state. */
export interface AddressBar {
  readonly search: Observable<string>;
  /** Replaces the query string without adding a history entry or reloading. */
  readonly replace: (search: string) => void;
}

/** A new version of the app, waiting for the person to choose to use it. */
export interface AppUpdates {
  readonly available: Observable<boolean>;
  /** Activates the new version and reloads the page into it. */
  readonly apply: () => void;
}

/**
 * Everything the app reads or writes outside React, injected at the composition root (`main.tsx`) so every screen runs against fakes in tests and against the browser in the app.
 */
export interface AppPorts {
  readonly store: GraphStoreClient;
  /** The sources the app can read, given the token to read GitHub with. */
  readonly sources: (token: string) => SourceLookup;
  readonly token: TokenStore;
  readonly syncRecords: SyncRecords;
  readonly themePreference: ThemePreferenceStore;
  readonly address: AddressBar;
  /** Whether the browser believes it is online. */
  readonly online: Observable<boolean>;
  /** Whether the system prefers a dark colour scheme. */
  readonly prefersDark: Observable<boolean>;
  readonly updates: AppUpdates;
  /** How views are laid out; the default is graph-layout's elkjs engine. Tests inject a stub engine. */
  readonly layout?: FlowLayoutOptions | undefined;
}
