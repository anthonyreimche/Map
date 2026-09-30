const EXIF_DATE = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/;

/** "YYYY:MM:DD HH:MM:SS" → epoch ms, read as local wall-clock time — the same
 *  reading core gives `dateCreated`, so the two never disagree by a zone. */
export function exifTime(s: string | undefined): number | undefined {
  if (!s) return undefined;
  const m = EXIF_DATE.exec(s);
  if (!m) return undefined;
  const [, y, mo, d, h, mi, se] = m;
  const t = new Date(+y, +mo - 1, +d, +h, +mi, +se).getTime();
  return Number.isNaN(t) ? undefined : t;
}
