// The handful of MapLibre style expressions our own layers use (map-layers.ts),
// evaluated for the basic map. Anything else throws, so a layer spec that
// grows a new operator fails style-eval's coverage test instead of drawing
// wrong in the basic map.

/** A feature's properties: GeoJSON leaves their shape open. */
export type Properties = Readonly<Record<string, unknown>>;

// A selection ring matches every point against the selected ids; one Set per
// label list keeps that a lookup instead of a scan for each point.
const labelSets = new WeakMap<readonly unknown[], Set<unknown>>();
function labelSet(labels: readonly unknown[]): Set<unknown> {
  let set = labelSets.get(labels);
  if (!set) {
    set = new Set(labels);
    labelSets.set(labels, set);
  }
  return set;
}

export function evaluate(expr: unknown, props: Properties): unknown {
  if (!Array.isArray(expr)) return expr;
  const [op, ...args] = expr as [unknown, ...unknown[]];
  switch (op) {
    case "get":
      return props[String(args[0])] ?? null;
    case "has":
      return String(args[0]) in props;
    case "!":
      return !evaluate(args[0], props);
    case "match": {
      const input = evaluate(args[0], props);
      for (let i = 1; i + 1 < args.length; i += 2) {
        const label = args[i];
        if (Array.isArray(label) ? labelSet(label).has(input) : label === input) return evaluate(args[i + 1], props);
      }
      return evaluate(args[args.length - 1], props);
    }
    case "step": {
      const input = Number(evaluate(args[0], props));
      let out = args[1];
      for (let i = 2; i + 1 < args.length; i += 2) {
        if (input >= Number(args[i])) out = args[i + 1];
      }
      return evaluate(out, props);
    }
    default:
      throw new Error(`[map] the basic map cannot evaluate "${String(op)}"`);
  }
}

/** A layer filter: absent passes everything, a boolean is a constant. */
export function passes(filter: unknown, props: Properties): boolean {
  if (filter === undefined) return true;
  return Boolean(evaluate(filter, props));
}
