// Cross-window "Show on map". Every window loads its own copy of this
// extension — its own store, its own module bindings — so a request raised
// from a Library grid in one window reaches a Map view mounted in another
// only through a channel like this one. The transport is injectable so
// activate() can be exercised in tests without a real BroadcastChannel and
// without mocking this module.

export interface FocusChannel {
  post(ids: readonly string[]): void;
  subscribe(handler: (ids: string[]) => void): () => void;
  close(): void;
}

export type FocusChannelFactory = () => FocusChannel;

export const CHANNEL_NAME = "safelight-map.focus";

const noop: FocusChannel = {
  post: () => {},
  subscribe: () => () => {},
  close: () => {},
};

/** The channel's name is fixed and guessable, so anything same-origin — a
 *  stray tab, another installed extension (this project's trust model treats
 *  extensions as untrusted) — can post to it. Never trust the shape of an
 *  incoming message: `data` must be an object whose `ids` is an array;
 *  non-string entries are dropped rather than rejecting the whole message,
 *  and an absent/malformed/empty result reads as no request at all, not an
 *  empty focus. */
export function parseFocusIds(data: unknown): string[] | null {
  if (typeof data !== "object" || data === null) return null;
  const ids = (data as { ids?: unknown }).ids;
  if (!Array.isArray(ids)) return null;
  const strings = ids.filter((id): id is string => typeof id === "string");
  return strings.length > 0 ? strings : null;
}

/** What broadcastChannelFactory attaches as its "message" listener, split
 *  out so a test can drive it with a plain `{ data }` stand-in instead of a
 *  real MessageEvent (only `.data` is ever read). */
export function toMessageListener(handler: (ids: string[]) => void): (e: { data: unknown }) => void {
  return (e) => {
    const ids = parseFocusIds(e.data);
    if (ids) handler(ids);
  };
}

/** The real transport. BroadcastChannel never delivers a post back to the
 *  port that sent it — exactly what's wanted here, since a window only posts
 *  after finding it has no local commands to call directly. Where it is
 *  absent, a no-op stands in. */
export function broadcastChannelFactory(): FocusChannel {
  if (typeof BroadcastChannel === "undefined") return noop;
  const bc = new BroadcastChannel(CHANNEL_NAME);
  return {
    post: (ids) => bc.postMessage({ ids: [...ids] }),
    subscribe: (handler) => {
      const onMessage = toMessageListener(handler);
      bc.addEventListener("message", onMessage);
      return () => bc.removeEventListener("message", onMessage);
    },
    close: () => bc.close(),
  };
}

let channel = noop;
let unsubscribe: (() => void) | null = null;

/** Opens the transport and starts listening for incoming focus requests.
 *  Closes any channel this module already had open, so calling it again
 *  without an intervening deactivate() (activate() re-run in a test, or a
 *  disable/enable cycle) never leaks the previous subscription. */
export function openFocusChannel(onRequest: (ids: string[]) => void, factory: FocusChannelFactory = broadcastChannelFactory): void {
  closeFocusChannel();
  channel = factory();
  unsubscribe = channel.subscribe(onRequest);
}

export function postFocusRequest(ids: readonly string[]): void {
  channel.post(ids);
}

export function closeFocusChannel(): void {
  unsubscribe?.();
  unsubscribe = null;
  channel.close();
  channel = noop;
}
