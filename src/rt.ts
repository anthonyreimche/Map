// Runtime bindings. JSX in every module compiles (classic transform) to
// React.createElement, resolved against the `React` re-exported here — the
// instance the host injects at activate(). A second React would break hooks.

import type { SafelightAPI, UiKit } from "./safelight";

export let React!: typeof import("react");
export let api!: SafelightAPI;
export let ui!: UiKit;

export function initRuntime(host: SafelightAPI): void {
  api = host;
  React = host.react;
  ui = host.ui;
}
