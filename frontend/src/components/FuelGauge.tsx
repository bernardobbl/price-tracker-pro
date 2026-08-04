/**
 * Indicador de carregamento em forma de marcador de tanque: o ponteiro varre
 * de E (vazio) para F (cheio) enquanto a ação está em andamento.
 *
 * É só ornamento — `aria-hidden`, porque quem usa leitor de tela já recebe o
 * aviso pelo próprio texto do botão ("Aguarde…"). A varredura para sozinha em
 * `prefers-reduced-motion` (o ponteiro fica parado no meio).
 */
export function FuelGauge() {
  return (
    <svg
      className="fuel-gauge"
      width="30"
      height="18"
      viewBox="0 0 32 19"
      aria-hidden="true"
      focusable="false"
    >
      {/* arco do mostrador */}
      <path
        d="M3 15 A13 13 0 0 1 29 15"
        fill="none"
        stroke="currentColor"
        strokeOpacity="0.3"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <text x="2" y="19" fontSize="6" fill="currentColor" fillOpacity="0.65">E</text>
      <text x="25" y="19" fontSize="6" fill="currentColor" fillOpacity="0.65">F</text>

      {/* ponteiro */}
      <g className="fuel-gauge-needle">
        <line x1="16" y1="15" x2="16" y2="5" stroke="var(--camel)" strokeWidth="2" strokeLinecap="round" />
      </g>
      <circle cx="16" cy="15" r="2" fill="var(--camel)" />
    </svg>
  );
}
