import { useEffect, useRef, useState } from "react";

/**
 * Anima um número de forma suave até `target` (usado no preço em destaque).
 * Respeita `prefers-reduced-motion` — nesse caso, pula direto pro valor final.
 */
export function useCountUp(target: number, durationMs = 600): number {
  const [value, setValue] = useState(target);
  const fromRef = useRef(target);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const from = fromRef.current;
    const delta = target - from;

    if (reduce || delta === 0) {
      setValue(target);
      fromRef.current = target;
      return;
    }

    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs);
      const eased = 1 - Math.pow(1 - t, 3); // easeOutCubic
      setValue(from + delta * eased);
      if (t < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        fromRef.current = target;
      }
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      fromRef.current = target;
    };
  }, [target, durationMs]);

  return value;
}
