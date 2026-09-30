const OFFSET = /^([+-])?(?:(\d+):)?(?:(\d{1,2}):)?(\d{1,2}|\d+)$/;

/** "±h:mm:ss", "±mm:ss" or "±ss" → seconds; "" → 0; malformed → null. */
export function parseOffset(text: string): number | null {
  const s = text.trim();
  if (s === "") return 0;
  const m = OFFSET.exec(s);
  if (!m) return null;
  const [, sign, a, b, c] = m;
  const parts = [a, b, c].filter((p): p is string => p !== undefined).map(Number);
  if (parts.length > 1 && parts.slice(1).some((p) => p > 59)) return null;
  const seconds = parts.reduce((acc, p) => acc * 60 + p, 0);
  return sign === "-" ? -seconds : seconds;
}

export function formatOffset(seconds: number): string {
  const abs = Math.abs(Math.round(seconds));
  const h = Math.floor(abs / 3600);
  const m = Math.floor((abs % 3600) / 60);
  const s = abs % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${seconds < 0 ? "-" : ""}${h}:${pad(m)}:${pad(s)}`;
}
