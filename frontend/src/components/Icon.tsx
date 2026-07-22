import type { SVGProps } from "react";

export type IconName =
  | "search"
  | "bell"
  | "trash"
  | "user"
  | "chart"
  | "trending-up"
  | "trending-down"
  | "trending-flat"
  | "check"
  | "plus"
  | "x"
  | "external"
  | "logout"
  | "tag";

// Paths no estilo Lucide (viewBox 24, stroke currentColor).
const PATHS: Record<IconName, string> = {
  search: "M11 11m-8 0a8 8 0 1 0 16 0a8 8 0 1 0 -16 0 M21 21l-4.35 -4.35",
  bell: "M10 5a2 2 0 0 1 4 0a7 7 0 0 1 4 6v3a4 4 0 0 0 2 3H4a4 4 0 0 0 2 -3v-3a7 7 0 0 1 4 -6 M9 17v1a3 3 0 0 0 6 0v-1",
  trash: "M4 7h16 M10 11v6 M14 11v6 M5 7l1 12a2 2 0 0 0 2 2h8a2 2 0 0 0 2 -2l1 -12 M9 7v-3a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v3",
  user: "M12 12m-4 0a4 4 0 1 0 8 0a4 4 0 1 0 -8 0 M6 21v-2a4 4 0 0 1 4 -4h4a4 4 0 0 1 4 4v2",
  chart: "M4 19l0 -14 M4 19l16 0 M8 15l3 -4l3 2l4 -6",
  "trending-up": "M3 17l6 -6l4 4l8 -8 M14 7l7 0l0 7",
  "trending-down": "M3 7l6 6l4 -4l8 8 M14 17l7 0l0 -7",
  "trending-flat": "M4 12l16 0 M16 8l4 4l-4 4",
  check: "M5 12l5 5l10 -10",
  plus: "M12 5l0 14 M5 12l14 0",
  x: "M6 6l12 12 M18 6l-12 12",
  external: "M12 6H6a2 2 0 0 0 -2 2v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2 -2v-6 M14 4h6v6 M10 14l10 -10",
  logout: "M14 8v-2a2 2 0 0 0 -2 -2H6a2 2 0 0 0 -2 2v12a2 2 0 0 0 2 2h6a2 2 0 0 0 2 -2v-2 M9 12h12l-3 -3 M18 15l3 -3",
  tag: "M7.5 7.5m-1 0a1 1 0 1 0 2 0a1 1 0 1 0 -2 0 M3 6v5.5a2 2 0 0 0 .6 1.4l7 7a2 2 0 0 0 2.8 0l5.5 -5.5a2 2 0 0 0 0 -2.8l-7 -7a2 2 0 0 0 -1.4 -.6H5a2 2 0 0 0 -2 2z"
};

interface IconProps extends Omit<SVGProps<SVGSVGElement>, "name"> {
  name: IconName;
  size?: number;
}

export function Icon({ name, size = 18, ...rest }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {PATHS[name].split(" M").map((seg, i) => (
        <path key={i} d={i === 0 ? seg : `M${seg}`} />
      ))}
    </svg>
  );
}
