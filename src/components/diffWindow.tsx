// Windowed rendering for big diffs: a whole-file diff of a 100k-line file is 100k rows, and one DOM node per
// token made File mode take seconds and half a million elements. Rows of a fixed height are positioned
// absolutely and only those near the viewport of the diff pane (.diff-body) are mounted.
import { useLayoutEffect, useRef, useState } from 'react';

/** Fixed row height of the windowed lists (the diff's 18 px line). */
export const ROW_H = 18;
/** Below this many rows a plain list is cheaper and keeps native text selection / find across rows. */
export const WINDOW_MIN = 400;

export function useWindow(count: number, rowH = ROW_H, overscan = 40) {
  const ref = useRef<HTMLDivElement>(null);
  const [range, setRange] = useState<[number, number]>([0, Math.min(count, 120)]);
  useLayoutEffect(() => {
    const el = ref.current;
    const scroller = el?.closest('.diff-body') as HTMLElement | null;
    if (!el || !scroller) return;
    let raf = 0;
    const update = () => {
      raf = 0;
      const off = el.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
      const first = Math.max(0, Math.floor(-off / rowH) - overscan);
      const last = Math.min(count, Math.ceil((-off + scroller.clientHeight) / rowH) + overscan);
      setRange((r) => (r[0] === first && r[1] === last ? r : [first, last]));
    };
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };
    update();
    scroller.addEventListener('scroll', schedule, { passive: true });
    const ro = new ResizeObserver(schedule);
    ro.observe(scroller);
    return () => {
      scroller.removeEventListener('scroll', schedule);
      ro.disconnect();
      if (raf) cancelAnimationFrame(raf);
    };
  }, [count, rowH, overscan]);
  return { ref, start: range[0], end: Math.min(range[1], count) };
}

/** `count` rows of `rowH` px of which only the visible ones are mounted. */
export function WindowedList({ count, rowH = ROW_H, children }: { count: number; rowH?: number; children: (i: number) => React.ReactNode }) {
  const { ref, start, end } = useWindow(count, rowH);
  const rows: React.ReactNode[] = [];
  for (let i = start; i < end; i++)
    rows.push(
      <div key={i} style={{ position: 'absolute', top: i * rowH, left: 0, right: 0, height: rowH }}>
        {children(i)}
      </div>,
    );
  return (
    <div ref={ref} style={{ position: 'relative', height: count * rowH }}>
      {rows}
    </div>
  );
}
