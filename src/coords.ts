// Coordinates typed or pasted into Set location: a decimal pair, degrees with
// minutes and seconds, either hemisphere notation, or a link from Google Maps,
// Apple Maps, OpenStreetMap or a geo: URI. Latitude comes first unless the
// hemisphere letters say otherwise, as every map app prints it.

import type { GpsFix } from "./geo";

const NUM = String.raw`[+-]?\d+(?:\.\d+)?`;

const GEO = new RegExp(String.raw`^geo:(${NUM}),(${NUM})`);

/** Links put the pair in a known place; each pattern captures lat, then lon.
 *  Most specific first: a Google place link's @ is the view it was copied
 *  from, wherever that was panned; the place itself is in !3d…!4d…. */
const LINKS = [
  new RegExp(String.raw`[?&]mlat=(${NUM})&(?:amp;)?mlon=(${NUM})`),
  new RegExp(String.raw`!3d(${NUM})!4d(${NUM})`),
  new RegExp(String.raw`[?&](?:q|ll|query|center|sll|daddr)=(${NUM}),\s*(${NUM})`),
  new RegExp(String.raw`#map=\d+(?:\.\d+)?/(${NUM})/(${NUM})`),
  GEO,
  new RegExp(String.raw`@(${NUM}),(${NUM})`),
];

type Token = { kind: "num"; value: string; unit: "°" | "'" | '"' | null } | { kind: "hemi"; value: "N" | "S" | "E" | "W" } | { kind: "sep" };

interface Group {
  nums: { value: string; unit: "°" | "'" | '"' | null }[];
  hemi: "N" | "S" | "E" | "W" | null;
}

const TOKEN = /\s*(?:([+-]?\d+(?:\.\d+)?)\s*([°'"])?|([A-Z]+)|(,))/y;

function tokenize(text: string): Token[] | null {
  const tokens: Token[] = [];
  TOKEN.lastIndex = 0;
  while (TOKEN.lastIndex < text.length) {
    if (/^\s*$/.test(text.slice(TOKEN.lastIndex))) break;
    const m = TOKEN.exec(text);
    if (!m) return null;
    const [, num, unit, word, sep] = m;
    if (num !== undefined) tokens.push({ kind: "num", value: num, unit: (unit as "°" | "'" | '"' | undefined) ?? null });
    else if (sep) tokens.push({ kind: "sep" });
    else if (word === "N" || word === "S" || word === "E" || word === "W") tokens.push({ kind: "hemi", value: word });
    else return null;
  }
  return tokens;
}

/** Splits the tokens into the two coordinates. Hemisphere letters mark the
 *  split where there are any (before the numbers if the text opens with one,
 *  else after); otherwise a comma, a new degree sign, or, for two bare
 *  numbers, the space between them. */
function group(tokens: Token[]): Group[] {
  const groups: Group[] = [];
  let current: Group = { nums: [], hemi: null };
  const close = () => {
    if (current.nums.length || current.hemi) groups.push(current);
    current = { nums: [], hemi: null };
  };
  const hemis = tokens.some((t) => t.kind === "hemi");
  const leading = tokens[0]?.kind === "hemi";
  const units = tokens.some((t) => t.kind === "num" && t.unit !== null);
  for (const t of tokens) {
    if (t.kind === "sep") close();
    else if (t.kind === "hemi") {
      if (leading) {
        close();
        current.hemi = t.value;
      } else {
        current.hemi = t.value;
        close();
      }
    } else {
      if (!hemis && current.nums.length > 0 && (units ? t.unit === "°" : true)) close();
      current.nums.push({ value: t.value, unit: t.unit });
    }
  }
  close();
  return groups;
}

const ORDER = ["°", "'", '"'] as const;

/** One coordinate's signed degrees, or null if its parts don't make one. */
function degrees(g: Group): number | null {
  if (g.nums.length === 0 || g.nums.length > 3) return null;
  if (g.nums.some((n, i) => n.unit !== null && n.unit !== ORDER[i])) return null;
  const [d, m = "0", s = "0"] = g.nums.map((n) => n.value);
  const negative = d.startsWith("-");
  if (g.nums.slice(1).some((n) => /^[+-]/.test(n.value))) return null;
  if (negative && (g.hemi === "S" || g.hemi === "W" || g.hemi === "N" || g.hemi === "E")) return null;
  // Minutes need whole degrees, seconds whole minutes; both stay under 60.
  if (g.nums.length > 1 && !/^[+-]?\d+$/.test(d)) return null;
  if (g.nums.length > 2 && !/^\d+$/.test(m)) return null;
  const minutes = Number(m);
  const seconds = Number(s);
  if (minutes >= 60 || seconds >= 60) return null;
  const magnitude = g.nums.length === 1 ? Math.abs(Number(d)) : Math.abs(Number(d)) + minutes / 60 + seconds / 3600;
  return negative || g.hemi === "S" || g.hemi === "W" ? -magnitude : magnitude;
}

const isLat = (h: Group["hemi"]) => h === "N" || h === "S";
const isLon = (h: Group["hemi"]) => h === "E" || h === "W";

function inRange(lat: number, lon: number): GpsFix | null {
  return Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? { lat, lon } : null;
}

function fromLink(text: string): GpsFix | null {
  let decoded = text;
  try {
    decoded = decodeURIComponent(text);
  } catch {
    // A stray "%" in pasted text: read it as typed.
  }
  for (const pattern of LINKS) {
    const m = pattern.exec(decoded);
    if (!m) continue;
    // geo:0,0?q=Some+Place is how Android shares a named place: no point in it.
    if (pattern === GEO && /[?&]q=/.test(decoded)) return null;
    return inRange(Number(m[1]), Number(m[2]));
  }
  return null;
}

export function parseCoordinates(input: string): GpsFix | null {
  const text = input.trim();
  if (!text) return null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(text)) return fromLink(text);

  let normalised = text
    .replace(/^[([](.*)[)\]]$/s, "$1")
    .replace(/[−–—]/g, "-")
    .replace(/[′’]/g, "'")
    .replace(/[″”]|''/g, '"')
    .replace(/º/g, "°")
    .toUpperCase();
  // With a semicolon between the two, commas are decimal points.
  if (normalised.includes(";")) {
    const parts = normalised.split(";");
    if (parts.length !== 2) return null;
    normalised = parts.map((p) => p.replace(/,/g, ".")).join(",");
  }

  const tokens = tokenize(normalised);
  if (!tokens) return null;
  const groups = group(tokens);
  if (groups.length !== 2) return null;
  const [a, b] = groups;
  const first = degrees(a);
  const second = degrees(b);
  if (first === null || second === null) return null;
  if ((isLat(a.hemi) && isLat(b.hemi)) || (isLon(a.hemi) && isLon(b.hemi))) return null;
  const swapped = isLon(a.hemi) || isLat(b.hemi);
  return swapped ? inRange(second, first) : inRange(first, second);
}

/** The pair Set location starts from: about a metre of precision. */
export function formatCoordinates({ lat, lon }: { lat: number; lon: number }): string {
  return `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
}

/** A pair as a reader checks it: "48.85840° N, 2.29450° E". */
export function describeFix({ lat, lon }: { lat: number; lon: number }): string {
  return `${Math.abs(lat).toFixed(5)}° ${lat < 0 ? "S" : "N"}, ${Math.abs(lon).toFixed(5)}° ${lon < 0 ? "W" : "E"}`;
}
