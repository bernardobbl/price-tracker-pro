import { useEffect, useRef } from "react";

/** Fio no rodapé do header (espaço do viewBox 1200×28). */
const WIRE_D =
  "M0 22 L150 17 L300 20 L450 12 L600 15 L750 9 L900 13 L1050 6 L1200 9";

const VIEW_W = 1200;
const VIEW_H = 28;

/** Duração de uma travessia completa do ponto. */
const TRAVEL_MS = 9000;

/**
 * Fio de dados vivo na borda inferior do header: uma linha fina com um ponto
 * dourado percorrendo devagar, de ponta a ponta.
 *
 * Decorativo e `aria-hidden`. O ponto é um elemento HTML posicionado em
 * porcentagem (e não um `<circle>`), porque o SVG usa
 * `preserveAspectRatio="none"` para esticar o fio na largura toda — dentro do
 * SVG o ponto viraria uma elipse achatada em telas estreitas.
 */
export function HeaderWire() {
  const pathRef = useRef<SVGPathElement>(null);
  const dotRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const path = pathRef.current;
    const dot = dotRef.current;
    if (!path || !dot) return;

    // Movimento reduzido: fica só o fio estático, sem ponto.
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const total = path.getTotalLength();
    let raf = 0;
    let elapsed = 0;
    let last = performance.now();

    const frame = (now: number) => {
      const dt = Math.min(now - last, 64); // retoma sem pulo após aba oculta
      last = now;
      elapsed += dt;

      const progress = (elapsed % TRAVEL_MS) / TRAVEL_MS;
      const point = path.getPointAtLength(progress * total);
      dot.style.left = `${(point.x / VIEW_W) * 100}%`;
      dot.style.top = `${(point.y / VIEW_H) * 100}%`;
      dot.style.opacity = String(Math.min(1, Math.sin(progress * Math.PI) * 3));

      raf = requestAnimationFrame(frame);
    };

    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div className="header-wire" aria-hidden="true">
      <svg viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} preserveAspectRatio="none">
        <path
          ref={pathRef}
          d={WIRE_D}
          fill="none"
          stroke="var(--brand)"
          strokeOpacity="0.22"
          strokeWidth="1.4"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <span className="header-wire-dot" ref={dotRef} />
    </div>
  );
}
