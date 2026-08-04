import { useEffect, useRef } from "react";

/* Geometria da cena (espaço do viewBox 1200×700).
   A "série" é uma curva de preço estilizada: sobe da esquerda para a direita
   com ruído, igual ao que o app desenha de verdade no gráfico. */
const SERIES_D =
  "M0 600 L133 545 L266 570 L400 470 L533 505 L666 405 L800 440 L933 330 L1066 360 L1200 250";
const AREA_D = `${SERIES_D} L1200 700 L0 700 Z`;

/** Marcos destacados na série (onde os anéis dourados pulsam). */
const MARKS = [
  { x: 400, y: 470 },
  { x: 666, y: 405 },
  { x: 933, y: 330 },
];

/** Curvas de fundo — "outras séries", bem apagadas, dando profundidade. */
const BG_CURVES = [
  "M0 170 Q300 110 600 165 T1200 130",
  "M0 300 Q300 240 600 295 T1200 260",
  "M0 430 Q300 375 600 425 T1200 390",
  "M0 560 Q300 510 600 555 T1200 520",
];

/** Duração de uma volta completa do ponto viajante. */
const TRAVEL_MS = 7000;
/** Duração do traçado inicial da linha. */
const DRAW_MS = 2600;

/**
 * Camada decorativa da tela de login.
 *
 * É puramente visual: não recebe props, não lê estado do app e é `aria-hidden`,
 * então leitores de tela a ignoram por completo. Respeita
 * `prefers-reduced-motion` (congela numa composição estática) e a animação
 * pausa sozinha quando a aba sai de foco, porque `requestAnimationFrame` não
 * dispara em aba oculta.
 */
export function DataBackdrop() {
  const rootRef = useRef<HTMLDivElement>(null);
  const lineRef = useRef<SVGPathElement>(null);
  const dotRef = useRef<SVGCircleElement>(null);
  const haloRef = useRef<SVGCircleElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    const line = lineRef.current;
    const dot = dotRef.current;
    const halo = haloRef.current;
    if (!root || !line || !dot || !halo) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const layers = Array.from(root.querySelectorAll<HTMLElement>("[data-depth]"));
    const total = line.getTotalLength();

    // ── Traçado inicial: a linha se desenha da esquerda para a direita ──
    line.style.strokeDasharray = String(total);
    if (reduced) {
      line.style.strokeDashoffset = "0";
    } else {
      line.style.strokeDashoffset = String(total);
      const draw = requestAnimationFrame(() => {
        line.style.transition = `stroke-dashoffset ${DRAW_MS}ms cubic-bezier(.4, 0, .2, 1)`;
        line.style.strokeDashoffset = "0";
      });
      // se desmontar antes do 2º frame, cancela o agendamento
      root.dataset.drawRaf = String(draw);
    }

    // Com movimento reduzido a cena fica parada: ponto no fim da série, sem parallax.
    if (reduced) {
      const end = line.getPointAtLength(total);
      for (const el of [dot, halo]) {
        el.setAttribute("cx", String(end.x));
        el.setAttribute("cy", String(end.y));
      }
      return;
    }

    // ── Loop: parallax do mouse + ponto percorrendo a série ──
    let raf = 0;
    let targetX = 0;
    let targetY = 0;
    let curX = 0;
    let curY = 0;
    let elapsed = 0;
    let last = performance.now();

    const onMove = (e: MouseEvent) => {
      targetX = (e.clientX / window.innerWidth - 0.5) * 2;
      targetY = (e.clientY / window.innerHeight - 0.5) * 2;
    };

    const frame = (now: number) => {
      // delta limitado: se a aba ficou oculta, retoma sem pulo
      const dt = Math.min(now - last, 64);
      last = now;
      elapsed += dt;

      curX += (targetX - curX) * 0.05;
      curY += (targetY - curY) * 0.05;
      for (const layer of layers) {
        const depth = Number(layer.dataset.depth) || 1;
        const dx = (-curX * depth * 14).toFixed(2);
        const dy = (-curY * depth * 14).toFixed(2);
        layer.style.transform = `translate3d(${dx}px, ${dy}px, 0)`;
      }

      const progress = (elapsed % TRAVEL_MS) / TRAVEL_MS;
      const point = line.getPointAtLength(progress * total);
      // some nas pontas para o ponto não "nascer" e "morrer" no meio do nada
      const fade = Math.min(1, Math.sin(progress * Math.PI) * 3).toFixed(3);
      for (const el of [dot, halo]) {
        el.setAttribute("cx", String(point.x));
        el.setAttribute("cy", String(point.y));
        el.setAttribute("opacity", fade);
      }

      raf = requestAnimationFrame(frame);
    };

    window.addEventListener("mousemove", onMove, { passive: true });
    raf = requestAnimationFrame(frame);

    return () => {
      window.removeEventListener("mousemove", onMove);
      cancelAnimationFrame(raf);
      const pending = Number(root.dataset.drawRaf);
      if (pending) cancelAnimationFrame(pending);
    };
  }, []);

  return (
    <div className="backdrop" ref={rootRef} aria-hidden="true">
      {/* fundo distante: outras séries, quase invisíveis */}
      <div className="backdrop-layer" data-depth="0.5">
        <svg viewBox="0 0 1200 700" preserveAspectRatio="xMidYMid slice">
          <g fill="none" stroke="var(--brand)" strokeOpacity="0.13" strokeWidth="1.5">
            {BG_CURVES.map((d) => (
              <path key={d} d={d} />
            ))}
          </g>
        </svg>
      </div>

      {/* halos de cor: dão calor ao papel sem virar gradiente óbvio */}
      <div className="backdrop-layer" data-depth="0.9">
        <svg viewBox="0 0 1200 700" preserveAspectRatio="xMidYMid slice">
          <circle cx="930" cy="180" r="200" fill="var(--camel)" fillOpacity="0.07" />
          <circle cx="200" cy="540" r="150" fill="var(--brand)" fillOpacity="0.06" />
        </svg>
      </div>

      {/* série principal: o elemento com movimento */}
      <div className="backdrop-layer" data-depth="1.5">
        <svg viewBox="0 0 1200 700" preserveAspectRatio="xMidYMid slice">
          <defs>
            <linearGradient id="backdrop-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--brand)" stopOpacity="0.22" />
              <stop offset="100%" stopColor="var(--brand)" stopOpacity="0" />
            </linearGradient>
            <radialGradient id="backdrop-halo">
              <stop offset="0%" stopColor="var(--camel)" stopOpacity="0.5" />
              <stop offset="100%" stopColor="var(--camel)" stopOpacity="0" />
            </radialGradient>
          </defs>

          <path d={AREA_D} fill="url(#backdrop-fill)" />
          <path
            ref={lineRef}
            d={SERIES_D}
            fill="none"
            stroke="var(--brand)"
            strokeOpacity="0.5"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />

          {MARKS.map((m, i) => (
            <circle
              key={`ring-${m.x}`}
              className="backdrop-pulse"
              style={{ animationDelay: `${i * 0.9}s` }}
              cx={m.x}
              cy={m.y}
              r="7"
              fill="none"
              stroke="var(--camel)"
              strokeOpacity="0.8"
              strokeWidth="2"
            />
          ))}
          {MARKS.map((m) => (
            <circle key={`dot-${m.x}`} cx={m.x} cy={m.y} r="5" fill="var(--camel)" fillOpacity="0.8" />
          ))}

          <circle ref={haloRef} r="26" fill="url(#backdrop-halo)" opacity="0" />
          <circle ref={dotRef} r="6.5" fill="var(--camel)" opacity="0" />
        </svg>
      </div>
    </div>
  );
}
