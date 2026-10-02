// The board's own icon set.
//
// Drawn for this toolbar on a 20px grid with a single 1.6px round stroke, so
// every glyph shares weight, corner radius and optical size. Inline SVG: no
// icon font to load, nothing to fetch, and each glyph is a few dozen bytes.

import type { ReactNode } from "react";

const glyphs = {
  select: <path d="M5.5 3.6 15.4 8.7l-4.5 1.5-1.9 4.6z" />,
  hand: (
    <path d="M7.2 10.3V5.6a1.2 1.2 0 0 1 2.4 0v3.6m0-.2V4.3a1.2 1.2 0 0 1 2.4 0v4.9m0-.1V5.4a1.2 1.2 0 0 1 2.4 0v6.2a5 5 0 0 1-5 5h-.5a4.5 4.5 0 0 1-3.5-1.7l-2.5-3.2a1.25 1.25 0 0 1 1.9-1.6l1.4 1.6" />
  ),
  pen: (
    <>
      <path d="M13.3 3.8a1.9 1.9 0 0 1 2.7 2.7l-8.6 8.6-3.6 1 1-3.6z" />
      <path d="m11.9 5.2 2.7 2.7" />
    </>
  ),
  marker: (
    <>
      <path d="m12.2 3.9 3.9 3.9-6.3 6.3H6v-3.8z" />
      <path d="m6 14.1-1.7 1.7M3.5 17.2h7" />
    </>
  ),
  eraser: (
    <>
      <path d="M8.6 16.4h7.9" />
      <path d="m4.1 11.7 7-7a1.7 1.7 0 0 1 2.4 0l2.2 2.2a1.7 1.7 0 0 1 0 2.4l-6.3 6.3a2.6 2.6 0 0 1-1.8.8H7.3a1.7 1.7 0 0 1-1.2-.5l-2-2a1.7 1.7 0 0 1 0-2.2z" />
      <path d="m7.4 8.5 4.6 4.6" />
    </>
  ),
  rectangle: <rect x="3.4" y="5" width="13.2" height="10" rx="2.4" />,
  ellipse: <ellipse cx="10" cy="10" rx="6.8" ry="5.3" />,
  diamond: (
    <path d="M9.1 3.6a1.3 1.3 0 0 1 1.8 0l5.5 5.5a1.3 1.3 0 0 1 0 1.8l-5.5 5.5a1.3 1.3 0 0 1-1.8 0l-5.5-5.5a1.3 1.3 0 0 1 0-1.8z" />
  ),
  arrow: (
    <>
      <path d="M4.6 15.4 15.2 4.8" />
      <path d="M9 4.6h6.4V11" />
    </>
  ),
  line: <path d="M4.6 15.4 15.4 4.6" />,
  text: <path d="M4.8 6V4.6h10.4V6M10 4.6v10.8m-2.2 0h4.4" />,
  sticky: (
    <>
      <path d="M5.4 3.8h9.2a1.6 1.6 0 0 1 1.6 1.6v6.4l-4.4 4.4H5.4a1.6 1.6 0 0 1-1.6-1.6V5.4a1.6 1.6 0 0 1 1.6-1.6z" />
      <path d="M11.8 16.2v-3a1.4 1.4 0 0 1 1.4-1.4h3" />
    </>
  ),
  image: (
    <>
      <rect x="3.4" y="4.2" width="13.2" height="11.6" rx="2.2" />
      <circle cx="7.6" cy="8.3" r="1.3" />
      <path d="m16.4 12.6-3.3-3.3-7.4 6.4" />
    </>
  ),
  undo: <path d="M7.4 5 4.3 8.1l3.1 3.1M4.3 8.1h7.6a3.9 3.9 0 0 1 0 7.8H9" />,
  redo: <path d="m12.6 5 3.1 3.1-3.1 3.1m3.1-3.1H8.1a3.9 3.9 0 0 0 0 7.8H11" />,
  plus: <path d="M10 4.6v10.8M4.6 10h10.8" />,
  minus: <path d="M4.6 10h10.8" />,
  more: (
    <g fill="currentColor" stroke="none">
      <circle cx="5" cy="10" r="1.35" />
      <circle cx="10" cy="10" r="1.35" />
      <circle cx="15" cy="10" r="1.35" />
    </g>
  ),
  trash: (
    <path d="M4 6.2h12M8.2 6.2V4.6h3.6v1.6M5.6 6.2l.7 9.3a1.5 1.5 0 0 0 1.5 1.4h4.4a1.5 1.5 0 0 0 1.5-1.4l.7-9.3" />
  ),
  duplicate: (
    <>
      <rect x="7.2" y="7.2" width="9.4" height="9.4" rx="2" />
      <path d="M12.8 7.2V5.4a1.8 1.8 0 0 0-1.8-1.8H5.4a1.8 1.8 0 0 0-1.8 1.8V11a1.8 1.8 0 0 0 1.8 1.8h1.8" />
    </>
  ),
  bringFront: (
    <>
      <rect x="3.6" y="3.6" width="8.4" height="8.4" rx="1.8" strokeDasharray="2 2" />
      <rect x="8" y="8" width="8.4" height="8.4" rx="1.8" fill="currentColor" fillOpacity="0.9" />
    </>
  ),
  sendBack: (
    <>
      <rect
        x="3.6"
        y="3.6"
        width="8.4"
        height="8.4"
        rx="1.8"
        fill="currentColor"
        fillOpacity="0.9"
      />
      <rect x="8" y="8" width="8.4" height="8.4" rx="1.8" strokeDasharray="2 2" />
    </>
  ),
  group: (
    <>
      <rect x="2.8" y="2.8" width="14.4" height="14.4" rx="2.4" strokeDasharray="2.2 2.2" />
      <rect x="6" y="6" width="4" height="4" rx="1" />
      <rect x="10" y="10" width="4" height="4" rx="1" />
    </>
  ),
  ungroup: (
    <>
      <rect x="3.6" y="3.6" width="5.4" height="5.4" rx="1.2" />
      <rect x="11" y="11" width="5.4" height="5.4" rx="1.2" />
    </>
  ),
  download: (
    <path d="M10 3.6v8.8m-3.4-3.4 3.4 3.4 3.4-3.4M4 13.8v1.4a1.6 1.6 0 0 0 1.6 1.6h8.8a1.6 1.6 0 0 0 1.6-1.6v-1.4" />
  ),
  copy: (
    <>
      <rect x="6.6" y="3.6" width="9.8" height="11" rx="2" />
      <path d="M4 6.8v8a2 2 0 0 0 2 2h6.4" />
    </>
  ),
  fit: (
    <path d="M3.8 7.4v-2a1.6 1.6 0 0 1 1.6-1.6h2m5.2 0h2a1.6 1.6 0 0 1 1.6 1.6v2m0 5.2v2a1.6 1.6 0 0 1-1.6 1.6h-2m-5.2 0h-2a1.6 1.6 0 0 1-1.6-1.6v-2" />
  ),
  grid: (
    <g fill="currentColor" stroke="none">
      {[5, 10, 15].flatMap((x) =>
        [5, 10, 15].map((y) => <circle key={`${x}-${y}`} cx={x} cy={y} r="1.15" />),
      )}
    </g>
  ),
  keyboard: (
    <>
      <rect x="2.6" y="5.2" width="14.8" height="9.6" rx="2" />
      <path d="M6 8.4h.01M9 8.4h.01M12 8.4h.01M15 8.4h.01M6.6 11.6h6.8" />
    </>
  ),
  chevron: <path d="m6.2 8.2 3.8 3.8 3.8-3.8" />,
  noFill: (
    <>
      <rect x="4" y="4" width="12" height="12" rx="3" />
      <path d="m5.2 14.8 9.6-9.6" />
    </>
  ),
  widthThin: <path d="M4 10h12" strokeWidth="1.2" />,
  widthMedium: <path d="M4 10h12" strokeWidth="2.6" />,
  widthBold: <path d="M4 10h12" strokeWidth="4.4" />,
  solid: <path d="M3.6 10h12.8" strokeWidth="2" />,
  dashed: <path d="M3.6 10h12.8" strokeWidth="2" strokeDasharray="3.4 2.4" />,
  dotted: <path d="M3.6 10h12.8" strokeWidth="2.2" strokeDasharray="0.01 3.2" />,
  sharp: <path d="M4.4 15.6V4.4h11.2" />,
  round: <path d="M4.4 15.6V9.8a5.4 5.4 0 0 1 5.4-5.4h5.8" />,
  headNone: <path d="M3.6 10h12.8" />,
  headArrow: <path d="M3.6 10h12.4m-4-4 4 4-4 4" />,
  headTriangle: (
    <>
      <path d="M3.6 10h8" />
      <path d="M11.4 6.2 16.4 10l-5 3.8z" fill="currentColor" />
    </>
  ),
  headDot: (
    <>
      <path d="M3.6 10h9" />
      <circle cx="14" cy="10" r="2.4" fill="currentColor" />
    </>
  ),
  headBar: <path d="M3.6 10h12.4m0-4.4v8.8" />,
  alignLeft: <path d="M4 5.4h12M4 10h7.6M4 14.6h10" />,
  alignCenter: <path d="M4 5.4h12M6.2 10h7.6M5 14.6h10" />,
  alignRight: <path d="M4 5.4h12M8.4 10H16M6 14.6h10" />,
  check: <path d="m5 10.4 3.2 3.2L15 6.8" />,
  eyedropper: (
    <>
      <path d="m11.6 5.4 3 3" />
      <path d="M13.2 3.8a1.9 1.9 0 0 1 2.7 2.7l-1.4 1.4-2.7-2.7z" />
      <path d="m12.4 7.6-6.7 6.7-.5 2.5 2.5-.5 6.7-6.7" />
    </>
  ),
  lock: (
    <>
      <rect x="4.6" y="8.8" width="10.8" height="8" rx="2" />
      <path d="M7.2 8.8V6.6a2.8 2.8 0 0 1 5.6 0v2.2" />
    </>
  ),
  unlock: (
    <>
      <rect x="4.6" y="8.8" width="10.8" height="8" rx="2" />
      <path d="M7.2 8.8V6.6a2.8 2.8 0 0 1 5.4-1" />
    </>
  ),
  sparkle: (
    <path d="M10 3.4c.5 3.3 1.9 4.9 5.2 5.4-3.3.5-4.7 2.1-5.2 5.4-.5-3.3-1.9-4.9-5.2-5.4 3.3-.5 4.7-2.1 5.2-5.4z" />
  ),
} satisfies Record<string, ReactNode>;

export type IconName = keyof typeof glyphs;

export function Icon({
  name,
  size = 20,
  className,
  flip,
}: {
  name: IconName;
  size?: number;
  className?: string;
  /** Mirror horizontally (a start arrowhead is an end arrowhead, flipped). */
  flip?: boolean;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={className}
      style={flip ? { transform: "scaleX(-1)" } : undefined}
    >
      {glyphs[name]}
    </svg>
  );
}
