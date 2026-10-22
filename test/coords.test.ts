import { describe, expect, it } from "vitest";
import { describeFix, formatCoordinates, parseCoordinates } from "../src/coords";

const EIFFEL = { lat: 48.8584, lon: 2.2945 };
const near = (text: string, lat: number, lon: number) => {
  const fix = parseCoordinates(text);
  expect(fix, text).not.toBeNull();
  expect(fix!.lat, text).toBeCloseTo(lat, 5);
  expect(fix!.lon, text).toBeCloseTo(lon, 5);
};

describe("parseCoordinates", () => {
  it("reads a decimal latitude, longitude pair, however it is separated", () => {
    for (const text of ["48.8584, 2.2945", "48.8584,2.2945", "48.8584 2.2945", "  (48.8584, 2.2945)  ", "[48.8584, 2.2945]"]) {
      expect(parseCoordinates(text), text).toEqual(EIFFEL);
    }
    near("-33.8568, 151.2153", -33.8568, 151.2153);
    near("−33.8568, 151.2153", -33.8568, 151.2153);
    near("48.8584, -2.2945", 48.8584, -2.2945);
    near("+48.8584 +2.2945", 48.8584, 2.2945);
  });

  it("reads decimal commas when a semicolon separates the two", () => {
    expect(parseCoordinates("48,8584; 2,2945")).toEqual(EIFFEL);
  });

  it("reads hemispheres before or after the numbers, in either order", () => {
    for (const text of ["48.8584 N, 2.2945 E", "48.8584° N 2.2945° E", "N 48.8584, E 2.2945", "N48.8584 E2.2945", "2.2945 E, 48.8584 N", "48.8584n 2.2945e"]) {
      near(text, 48.8584, 2.2945);
    }
    near("33.8568° S, 151.2153° E", -33.8568, 151.2153);
    near("40.7128 N 74.0060 W", 40.7128, -74.006);
  });

  it("reads degrees, minutes and seconds as map apps print them", () => {
    near(`48°51'30.2"N 2°17'40.2"E`, 48 + 51 / 60 + 30.2 / 3600, 2 + 17 / 60 + 40.2 / 3600);
    near("48°51′30.2″N 2°17′40.2″E", 48 + 51 / 60 + 30.2 / 3600, 2 + 17 / 60 + 40.2 / 3600);
    near(`33° 51' 24.5" S, 151° 12' 55.1" E`, -(33 + 51 / 60 + 24.5 / 3600), 151 + 12 / 60 + 55.1 / 3600);
    near("48 51 30 N 2 17 40 E", 48 + 51 / 60 + 30 / 3600, 2 + 17 / 60 + 40 / 3600);
    near(`48°51'30" 2°17'40"`, 48 + 51 / 60 + 30 / 3600, 2 + 17 / 60 + 40 / 3600);
  });

  it("reads degrees and decimal minutes", () => {
    near("48°51.503'N, 2°17.67'E", 48 + 51.503 / 60, 2 + 17.67 / 60);
    near("N 48° 51.503' W 2° 17.67'", 48 + 51.503 / 60, -(2 + 17.67 / 60));
  });

  it("finds the location in a map link", () => {
    near("https://www.google.com/maps/place/Eiffel+Tower/@48.8583701,2.2944813,17z/data=!3m1!4b1", 48.8583701, 2.2944813);
    // A place link's @ is wherever the view was panned; the place is !3d…!4d….
    near("https://www.google.com/maps/place/Eiffel+Tower/@48.86,2.31,14z/data=!4m6!3m5!1s0x0:0x0!8m2!3d48.8583701!4d2.2944813!16s", 48.8583701, 2.2944813);
    near("https://maps.google.com/?q=48.8584,2.2945", 48.8584, 2.2945);
    near("https://www.google.com/maps/search/?api=1&query=48.8584%2C2.2945", 48.8584, 2.2945);
    near("https://maps.apple.com/?ll=48.8584,2.2945&z=16", 48.8584, 2.2945);
    near("https://www.openstreetmap.org/?mlat=48.8584&mlon=2.2945#map=17/48.85840/2.29450", 48.8584, 2.2945);
    near("https://www.openstreetmap.org/#map=17/48.8584/2.2945", 48.8584, 2.2945);
    near("geo:48.8584,2.2945?z=17", 48.8584, 2.2945);
    near("geo:0,0?q=48.8584,2.2945(Eiffel Tower)", 48.8584, 2.2945);
  });

  it("refuses a geo: link that names a place instead of a point", () => {
    expect(parseCoordinates("geo:0,0?q=Eiffel+Tower,+Paris")).toBeNull();
  });

  it("refuses anything that is not one location on Earth", () => {
    for (const text of [
      "",
      "   ",
      "Paris",
      "48.8584",
      "48.8584, 2.2945, 35",
      "91, 0",
      "0, 181",
      "-91 0",
      `48°61'N 2°E`,
      `48°51'60"N 2°E`,
      "48.5°30'N 2°E",
      "48.8584 N 2.2945 N",
      "48.8584 E 2.2945 W",
      "-48.8584 S, 2.2945 E",
      "48.8584, 2.2945 Paris",
      "https://example.com/maps",
    ]) {
      expect(parseCoordinates(text), text).toBeNull();
    }
  });
});

describe("formatCoordinates", () => {
  it("writes a pair the parser reads back, to about a metre", () => {
    expect(formatCoordinates({ lat: 48.858370123, lon: -2.2944813 })).toBe("48.85837, -2.29448");
    expect(parseCoordinates(formatCoordinates(EIFFEL))).toEqual(EIFFEL);
  });
});

describe("describeFix", () => {
  it("names the hemispheres", () => {
    expect(describeFix({ lat: -33.8568, lon: 151.2153 })).toBe("33.85680° S, 151.21530° E");
    expect(describeFix({ lat: 48.8584, lon: -2.2945 })).toBe("48.85840° N, 2.29450° W");
  });
});
