import { describe, expect, it } from "vitest";
import { formatOffset, parseOffset } from "../src/offset";

describe("parseOffset", () => {
  it("reads h:mm:ss, mm:ss and plain seconds with an optional sign", () => {
    expect(parseOffset("1:02:03")).toBe(3723);
    expect(parseOffset("-1:02:03")).toBe(-3723);
    expect(parseOffset("+02:03")).toBe(123);
    expect(parseOffset("45")).toBe(45);
    expect(parseOffset(" -7 ")).toBe(-7);
    expect(parseOffset("")).toBe(0);
  });

  it("rejects malformed text", () => {
    expect(parseOffset("abc")).toBeNull();
    expect(parseOffset("1:2:3:4")).toBeNull();
    expect(parseOffset("1:99")).toBeNull();
  });
});

describe("formatOffset", () => {
  it("is the canonical ±h:mm:ss", () => {
    expect(formatOffset(0)).toBe("0:00:00");
    expect(formatOffset(3723)).toBe("1:02:03");
    expect(formatOffset(-59)).toBe("-0:00:59");
  });

  it("round-trips through parseOffset", () => {
    for (const s of [0, 1, 59, 60, 3600, -3723, 86400]) expect(parseOffset(formatOffset(s))).toBe(s);
  });
});
