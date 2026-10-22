import { describe, expect, it } from "vitest";
import { createFakeVariables } from "./fake-variables";

describe("createFakeVariables", () => {
  it("follows core's register, subscribe and stale-write rules", () => {
    const vars = createFakeVariables();
    const map = vars.forExtension("map");
    const gps = vars.forExtension("gps-track");

    const heard: unknown[] = [];
    map.register("map.overlays", { initial: {} });
    map.subscribe("map.overlays", (s) => heard.push(s.value));

    // The first initial wins; a later register returns what is already there.
    expect(gps.register("map.overlays", { initial: { ignored: true } }).value).toEqual({});

    expect(gps.update<Record<string, number>>("map.overlays", (cur) => ({ ...cur, a: 1 })).ok).toBe(true);
    // map saw revision 1 through its subscription, so its write is current.
    expect(map.set("map.overlays", {}).ok).toBe(true);
    // gps-track last saw its own write (revision 1); map has written since.
    expect(gps.set("map.overlays", { b: 2 })).toMatchObject({ ok: false, reason: "stale" });
    expect(gps.set("nobody.registered", 1)).toEqual({ ok: false, reason: "unregistered" });

    expect(heard).toEqual([{}, { a: 1 }, {}]);
    const snap = vars.snapshot("map.overlays");
    expect(snap?.writer.extension).toBe("map");
    expect(Object.isFrozen(snap?.value)).toBe(true);
  });

  it("delivers writes made inside a listener after the delivery in progress, in order", () => {
    const vars = createFakeVariables();
    const x = vars.forExtension("x");
    const b = vars.forExtension("b");
    const c = vars.forExtension("c");

    x.register("v", { initial: 0 });
    const heardB: number[] = [];
    const heardC: number[] = [];
    b.subscribe<number>("v", (s) => {
      heardB.push(s.value);
      if (s.value === 1) b.set("v", 2);
    });
    c.subscribe<number>("v", (s) => heardC.push(s.value));

    expect(x.set("v", 1).ok).toBe(true);

    expect(heardB).toEqual([0, 1, 2]);
    expect(heardC).toEqual([0, 1, 2]);
    // c saw revision 2 last, so its own write is not stale.
    expect(c.set("v", 3).ok).toBe(true);
  });
});
