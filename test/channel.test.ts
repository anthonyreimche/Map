import { afterEach, describe, expect, it, vi } from "vitest";
import {
  broadcastChannelFactory,
  closeFocusChannel,
  openFocusChannel,
  parseFocusIds,
  postFocusRequest,
  toMessageListener,
} from "../src/channel";
import { createFakeChannel } from "./fake-channel";

afterEach(() => {
  closeFocusChannel();
  vi.unstubAllGlobals();
});

describe("broadcastChannelFactory", () => {
  // This suite's Node runtime actually provides a global BroadcastChannel
  // (unlike a bare jsdom environment, which has none), so the missing-API
  // environment this guards against — some older browsers, some Electron
  // renderer contexts — is simulated rather than relied on.
  it("is a no-op transport when BroadcastChannel is unavailable", () => {
    vi.stubGlobal("BroadcastChannel", undefined);
    const ch = broadcastChannelFactory();
    const handler = vi.fn();
    const unsubscribe = ch.subscribe(handler);
    expect(() => ch.post(["a"])).not.toThrow();
    expect(handler).not.toHaveBeenCalled();
    expect(() => unsubscribe()).not.toThrow();
    expect(() => ch.close()).not.toThrow();
  });

  it("is a no-op transport when BroadcastChannel refuses to open", () => {
    vi.stubGlobal(
      "BroadcastChannel",
      class {
        constructor() {
          throw new DOMException("The operation is insecure.", "SecurityError");
        }
      },
    );
    const ch = broadcastChannelFactory();
    expect(() => ch.subscribe(() => {})()).not.toThrow();
    expect(() => ch.post(["a"])).not.toThrow();
    expect(() => ch.close()).not.toThrow();
  });
});

describe("parseFocusIds", () => {
  it("rejects null, undefined and non-object payloads", () => {
    expect(parseFocusIds(null)).toBeNull();
    expect(parseFocusIds(undefined)).toBeNull();
    expect(parseFocusIds("just a string")).toBeNull();
    expect(parseFocusIds(42)).toBeNull();
  });

  it("rejects an object with no ids, or ids that isn't an array", () => {
    expect(parseFocusIds({})).toBeNull();
    expect(parseFocusIds({ ids: "a" })).toBeNull();
    expect(parseFocusIds({ ids: 5 })).toBeNull();
    expect(parseFocusIds({ ids: null })).toBeNull();
  });

  it("keeps only the string entries, in order", () => {
    expect(parseFocusIds({ ids: ["a", 1, null, "b", {}, undefined, "c"] })).toEqual(["a", "b", "c"]);
  });

  it("rejects an ids array with nothing but non-string entries", () => {
    expect(parseFocusIds({ ids: [1, null, {}] })).toBeNull();
  });

  it("accepts a well-formed request", () => {
    expect(parseFocusIds({ ids: ["a", "b"] })).toEqual(["a", "b"]);
  });
});

describe("toMessageListener", () => {
  // This is exactly what broadcastChannelFactory attaches via
  // bc.addEventListener("message", ...): the channel name is fixed and
  // guessable, so any same-origin code — another tab, another installed
  // extension (this project's trust model treats extensions as untrusted) —
  // can post whatever it likes to it. A plain `{ data }` stand-in exercises
  // the listener the same way a real MessageEvent would (only `.data` is
  // ever read) without depending on `dispatchEvent`, which Node's
  // BroadcastChannel refuses for a jsdom-realm MessageEvent instance in this
  // test environment (a jsdom/Node dual-Event-hierarchy mismatch, not
  // something a fake or a mock would sidestep any more cleanly).
  it("drops null, a non-object, missing ids, and ids that isn't an array, without throwing or calling the handler", () => {
    const handler = vi.fn();
    const onMessage = toMessageListener(handler);
    const badPayloads: unknown[] = [null, undefined, "just a string", 42, {}, { ids: "not-an-array" }, { ids: 5 }, { ids: null }];
    for (const data of badPayloads) {
      expect(() => onMessage({ data })).not.toThrow();
    }
    expect(handler).not.toHaveBeenCalled();
  });

  it("keeps only the string entries from a message with mixed ids", () => {
    const handler = vi.fn();
    const onMessage = toMessageListener(handler);
    expect(() => onMessage({ data: { ids: ["a", 1, null, "b", {}, undefined] } })).not.toThrow();
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(["a", "b"]);
  });
});

describe("openFocusChannel / postFocusRequest", () => {
  it("delivers a post from another port to the opened handler", () => {
    const { factory } = createFakeChannel();
    const received: string[][] = [];
    openFocusChannel((ids) => received.push(ids), factory);
    factory().post(["x", "y"]);
    expect(received).toEqual([["x", "y"]]);
  });

  it("never delivers a port's own post back to itself", () => {
    const { factory } = createFakeChannel();
    const received: string[][] = [];
    openFocusChannel((ids) => received.push(ids), factory);
    postFocusRequest(["self"]);
    expect(received).toEqual([]);
  });

  it("postFocusRequest forwards to whatever channel is currently open", () => {
    const { factory } = createFakeChannel();
    openFocusChannel(() => {}, factory);
    const received: string[][] = [];
    factory().subscribe((ids) => received.push(ids));
    postFocusRequest(["z"]);
    expect(received).toEqual([["z"]]);
  });

  it("stops delivering once closed", () => {
    const { factory } = createFakeChannel();
    const received: string[][] = [];
    openFocusChannel((ids) => received.push(ids), factory);
    closeFocusChannel();
    factory().post(["late"]);
    expect(received).toEqual([]);
  });

  it("closes a previously open channel when opened again", () => {
    const busA = createFakeChannel();
    const busB = createFakeChannel();
    const received: string[][] = [];
    openFocusChannel((ids) => received.push(ids), busA.factory);
    openFocusChannel((ids) => received.push(ids), busB.factory);
    busA.factory().post(["ignored"]);
    busB.factory().post(["seen"]);
    expect(received).toEqual([["seen"]]);
  });
});
