import { describe, expect, it } from "vitest";
import { abbreviate, clusterAt, expansionZoom } from "../src/cluster";
import { toUnit } from "../src/mercator";

const at = (id: string, lon: number, lat: number) => ({ id, ...toUnit({ lon, lat }) });
// Two photos 0.01° apart in Paris, one in Lyon.
const points = [at("a", 2.29, 48.85), at("b", 2.3, 48.85), at("c", 4.83, 45.76)];

describe("clusterAt", () => {
  it("merges points within the radius into one cluster at their centroid", () => {
    const out = clusterAt(points, 5, 40);
    const cluster = out.find((c) => c.kind === "cluster");
    expect(cluster).toMatchObject({ kind: "cluster", count: 2, members: ["a", "b"] });
    expect(cluster?.x).toBeCloseTo((points[0].x + points[1].x) / 2, 12);
    expect(out.filter((c) => c.kind === "point").map((c) => c.kind === "point" && c.id)).toEqual(["c"]);
  });

  it("keeps points apart once they are further than the radius on screen", () => {
    expect(clusterAt(points, 16, 40).every((c) => c.kind === "point")).toBe(true);
  });

  it("gives every cluster a distinct id that names its zoom", () => {
    const many = Array.from({ length: 40 }, (_, i) => at(`p${i}`, (i % 8) * 20 - 80, Math.floor(i / 8) * 10));
    const ids = clusterAt(many, 1, 80).flatMap((c) => (c.kind === "cluster" ? [c.clusterId] : []));
    expect(ids.length).toBeGreaterThan(1);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every((id) => id % 32 === 1)).toBe(true);
  });

  it("finds the zoom at which a cluster splits", () => {
    const cluster = clusterAt(points, 5, 40).find((c) => c.kind === "cluster");
    const z = expansionZoom(points, cluster!.kind === "cluster" ? cluster!.members : [], 5, 40, 17);
    expect(clusterAt(points, z, 40).filter((c) => c.kind === "point").length).toBeGreaterThanOrEqual(2);
    expect(clusterAt(points, z - 1, 40).some((c) => c.kind === "cluster" && c.count === 2)).toBe(true);
  });

  it("never expands past one zoom above the cluster limit", () => {
    const same = [at("a", 2.29, 48.85), at("b", 2.29, 48.85)];
    expect(expansionZoom(same, ["a", "b"], 5, 40, 17)).toBe(18);
  });
});

describe("abbreviate", () => {
  it("abbreviates counts the way MapLibre's clusters do", () => {
    expect(abbreviate(7)).toBe("7");
    expect(abbreviate(999)).toBe("999");
    expect(abbreviate(1234)).toBe("1.2k");
    expect(abbreviate(1000)).toBe("1k");
    expect(abbreviate(15_678)).toBe("16k");
  });
});
