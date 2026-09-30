import { describe, expect, it } from "vitest";
import { exifTime } from "../src/exif-time";

describe("exifTime", () => {
  it("reads the EXIF wall clock as local time, like core's dateCreated", () => {
    expect(exifTime("2024:06:01 12:30:05")).toBe(new Date(2024, 5, 1, 12, 30, 5).getTime());
  });

  it("tolerates a T separator and trailing fractions", () => {
    expect(exifTime("2024:06:01T12:30:05.25")).toBe(new Date(2024, 5, 1, 12, 30, 5).getTime());
  });

  it("rejects missing and malformed values", () => {
    expect(exifTime(undefined)).toBeUndefined();
    expect(exifTime("")).toBeUndefined();
    expect(exifTime("2024-06-01 12:30:05")).toBeUndefined();
    expect(exifTime("    :  :     :  :  ")).toBeUndefined();
  });
});
