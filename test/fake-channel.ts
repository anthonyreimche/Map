// A synchronous, in-memory stand-in for BroadcastChannel, for tests only: a
// real one delivers asynchronously and reaches every open port with the same
// name. Every port from one createFakeChannel() shares its bus, and, matching
// real BroadcastChannel, a port never receives its own post.

import type { FocusChannel, FocusChannelFactory } from "../src/channel";

export function createFakeChannel(): { factory: FocusChannelFactory } {
  const subscribers = new Set<{ handler: (ids: string[]) => void }>();
  const factory: FocusChannelFactory = () => {
    const self = { handler: (_ids: string[]) => {} };
    const port: FocusChannel = {
      post: (ids) => {
        for (const sub of subscribers) if (sub !== self) sub.handler([...ids]);
      },
      subscribe: (handler) => {
        self.handler = handler;
        subscribers.add(self);
        return () => subscribers.delete(self);
      },
      close: () => void subscribers.delete(self),
    };
    return port;
  };
  return { factory };
}
