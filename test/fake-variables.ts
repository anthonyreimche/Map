// An in-memory stand-in for core's api.variables (one window) with the same
// rules: register is idempotent, subscribe hears the current value at once,
// a set() from an extension that hasn't seen the current revision is refused,
// and deliveries run in order: a write made inside a listener is queued and
// heard after the delivery in progress, never nested into it. One instance
// can be shared by several harnesses.

import type { SharedVariablesAPI, VariableSnapshot, VariableWriteResult } from "../src/safelight";

export interface FakeVariables {
  forExtension(extension: string): SharedVariablesAPI;
  snapshot<T>(name: string): VariableSnapshot<T> | undefined;
}

const WINDOW = "test-window";

interface Subscriber {
  extension: string;
  listener: (s: VariableSnapshot<unknown>) => void;
}

function freeze<T>(v: T): T {
  if (v === null || typeof v !== "object") return v;
  if (Array.isArray(v)) return Object.freeze(v.map((x: unknown) => freeze(x))) as T;
  const out: Record<string, unknown> = {};
  for (const [k, x] of Object.entries(v)) if (x !== undefined) out[k] = freeze(x);
  return Object.freeze(out) as T;
}

export function createFakeVariables(): FakeVariables {
  const entries = new Map<string, VariableSnapshot<unknown>>();
  const subscribers = new Map<string, Subscriber[]>();
  const seen = new Map<string, number>();
  const seenKey = (extension: string, name: string) => `${extension}\n${name}`;

  // Only ever raises: an older revision arriving late must not make the
  // extension look as if it had not seen a newer one.
  const see = (extension: string, name: string, n: number) => {
    const key = seenKey(extension, name);
    const prev = seen.get(key);
    if (prev === undefined || prev < n) seen.set(key, n);
  };

  // Core queues a delivery made while another is running and drains the queue
  // in order. Recipients are fixed when a delivery is queued; one that has
  // unsubscribed by the time its turn comes is skipped.
  const queue: { snapshot: VariableSnapshot<unknown>; to: Subscriber[] }[] = [];
  let delivering = false;

  const enqueue = (snapshot: VariableSnapshot<unknown>, to: Subscriber[]) => {
    queue.push({ snapshot, to });
    if (delivering) return;
    delivering = true;
    try {
      for (let next = queue.shift(); next; next = queue.shift()) {
        for (const sub of next.to) {
          if (!(subscribers.get(next.snapshot.name) ?? []).includes(sub)) continue;
          see(sub.extension, next.snapshot.name, next.snapshot.revision.n);
          sub.listener(next.snapshot);
        }
      }
    } finally {
      delivering = false;
    }
  };

  const deliver = (s: VariableSnapshot<unknown>) => enqueue(s, [...(subscribers.get(s.name) ?? [])]);

  const write = (extension: string, prev: VariableSnapshot<unknown>, value: unknown) => {
    const next: VariableSnapshot<unknown> = Object.freeze({
      ...prev,
      value: freeze(value),
      revision: { n: prev.revision.n + 1, window: WINDOW },
      writer: { extension, window: WINDOW },
    });
    entries.set(prev.name, next);
    see(extension, prev.name, next.revision.n);
    deliver(next);
    return next.revision;
  };

  const forExtension = (extension: string): SharedVariablesAPI => ({
    register<T>(name: string, init: { initial: T; description?: string }): VariableSnapshot<T> {
      const existing = entries.get(name);
      if (existing) {
        see(extension, name, existing.revision.n);
        return existing as VariableSnapshot<T>;
      }
      const writer = { extension, window: WINDOW };
      const s: VariableSnapshot<unknown> = Object.freeze({
        name,
        value: freeze(init.initial),
        revision: { n: 0, window: WINDOW },
        writer,
        registeredBy: writer,
        ...(init.description !== undefined ? { description: init.description } : {}),
      });
      entries.set(name, s);
      see(extension, name, 0);
      deliver(s);
      return s as VariableSnapshot<T>;
    },
    get<T>(name: string): VariableSnapshot<T> | undefined {
      const s = entries.get(name);
      if (s) see(extension, name, s.revision.n);
      return s as VariableSnapshot<T> | undefined;
    },
    subscribe<T>(name: string, listener: (s: VariableSnapshot<T>) => void): () => void {
      const sub: Subscriber = { extension, listener: listener as (s: VariableSnapshot<unknown>) => void };
      subscribers.set(name, [...(subscribers.get(name) ?? []), sub]);
      const s = entries.get(name);
      // Queued like any delivery, so a subscribe made inside a listener hears
      // the current value right after that delivery finishes.
      if (s) enqueue(s, [sub]);
      return () => subscribers.set(name, (subscribers.get(name) ?? []).filter((x) => x !== sub));
    },
    set<T>(name: string, value: T): VariableWriteResult<T> {
      const s = entries.get(name);
      if (!s) return { ok: false, reason: "unregistered" };
      if (seen.get(seenKey(extension, name)) !== s.revision.n)
        return { ok: false, reason: "stale", current: s as VariableSnapshot<T> };
      return { ok: true, revision: write(extension, s, value) };
    },
    update<T>(name: string, fn: (current: T) => T): VariableWriteResult<T> {
      const s = entries.get(name);
      if (!s) return { ok: false, reason: "unregistered" };
      return { ok: true, revision: write(extension, s, fn(s.value as T)) };
    },
  });

  return { forExtension, snapshot: <T,>(name: string) => entries.get(name) as VariableSnapshot<T> | undefined };
}
