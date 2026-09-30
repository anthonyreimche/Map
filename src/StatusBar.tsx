import { React } from "./rt";
import { useMapStore } from "./store";
import { countsText } from "./Toolbar";

export function StatusBar() {
  const located = useMapStore((s) => s.located);
  const total = useMapStore((s) => s.total);
  const inView = useMapStore((s) => s.inView);
  return <span>{countsText(located, total, inView)}</span>;
}
