import type { SVGProps } from "react";

/**
 * Single stroke icon set — 24px viewBox, `currentColor`, ~1.8 stroke.
 * Always pass explicit `width`/`height` at the call site: an unsized icon
 * inherits font-size and can balloon (clamp status-message icons to 16px).
 */
export type IconProps = SVGProps<SVGSVGElement>;
export type IconComponent = (props: IconProps) => React.JSX.Element;

const s = {
  fill: "none" as const,
  stroke: "currentColor",
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

export const Icon = {
  gear: (p: IconProps) => (
    <svg viewBox="0 0 24 24" strokeWidth={1.8} {...s} {...p}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  ),
  sync: (p: IconProps) => (
    <svg viewBox="0 0 24 24" strokeWidth={1.9} {...s} {...p}>
      <path d="M21 12a9 9 0 0 1-9 9 9 9 0 0 1-8.5-6" />
      <path d="M3 12a9 9 0 0 1 9-9 9 9 0 0 1 8.5 6" />
      <path d="M21 3v5h-5" />
      <path d="M3 21v-5h5" />
    </svg>
  ),
  arrowLeft: (p: IconProps) => (
    <svg viewBox="0 0 24 24" strokeWidth={2} {...s} {...p}>
      <path d="M19 12H5M12 19l-7-7 7-7" />
    </svg>
  ),
  chevR: (p: IconProps) => (
    <svg viewBox="0 0 24 24" strokeWidth={2} {...s} {...p}>
      <path d="M9 18l6-6-6-6" />
    </svg>
  ),
  chevD: (p: IconProps) => (
    <svg viewBox="0 0 24 24" strokeWidth={2} {...s} {...p}>
      <path d="M6 9l6 6 6-6" />
    </svg>
  ),
  check: (p: IconProps) => (
    <svg viewBox="0 0 24 24" strokeWidth={2.6} {...s} {...p}>
      <path d="M20 6L9 17l-5-5" />
    </svg>
  ),
  sparkle: (p: IconProps) => (
    <svg viewBox="0 0 24 24" fill="currentColor" {...p}>
      <path d="M12 2.5l1.9 5.6 5.6 1.9-5.6 1.9L12 17.5l-1.9-5.6L4.5 10l5.6-1.9L12 2.5z" />
    </svg>
  ),
  warnTri: (p: IconProps) => (
    <svg viewBox="0 0 24 24" strokeWidth={1.9} {...s} {...p}>
      <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
    </svg>
  ),
  alertCircle: (p: IconProps) => (
    <svg viewBox="0 0 24 24" strokeWidth={1.9} {...s} {...p}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 8v4" />
      <path d="M12 16h.01" />
    </svg>
  ),
  box: (p: IconProps) => (
    <svg viewBox="0 0 24 24" strokeWidth={1.7} {...s} {...p}>
      <path d="M21 8 12 3 3 8v8l9 5 9-5V8z" />
      <path d="M3.3 7.5 12 12.5l8.7-5" />
      <path d="M12 22V12.5" />
    </svg>
  ),
  refresh: (p: IconProps) => (
    <svg viewBox="0 0 24 24" strokeWidth={1.8} {...s} {...p}>
      <path d="M21 2v6h-6" />
      <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
      <path d="M3 22v-6h6" />
      <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
    </svg>
  ),
  history: (p: IconProps) => (
    <svg viewBox="0 0 24 24" strokeWidth={1.8} {...s} {...p}>
      <path d="M3 3v5h5" />
      <path d="M3.05 13A9 9 0 1 0 6 5.3L3 8" />
      <path d="M12 7v5l3 2" />
    </svg>
  ),
  link: (p: IconProps) => (
    <svg viewBox="0 0 24 24" strokeWidth={1.8} {...s} {...p}>
      <path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1.5 1.5" />
      <path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1.5-1.5" />
    </svg>
  ),
  globe: (p: IconProps) => (
    <svg viewBox="0 0 24 24" strokeWidth={1.8} {...s} {...p}>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18" />
      <path d="M12 3a14 14 0 0 1 0 18 14 14 0 0 1 0-18z" />
    </svg>
  ),
  bug: (p: IconProps) => (
    <svg viewBox="0 0 24 24" strokeWidth={1.8} {...s} {...p}>
      <rect x="8" y="6" width="8" height="13" rx="4" />
      <path d="M19 7l-3 2M5 7l3 2M3 13h3M18 13h3M19 19l-3-2M5 19l3-2M12 2v3" />
    </svg>
  ),
  bulb: (p: IconProps) => (
    <svg viewBox="0 0 24 24" strokeWidth={1.8} {...s} {...p}>
      <path d="M9 18h6" />
      <path d="M10 22h4" />
      <path d="M12 2a7 7 0 0 0-4 12.7c.6.5 1 1.2 1 2h6c0-.8.4-1.5 1-2A7 7 0 0 0 12 2z" />
    </svg>
  ),
  store: (p: IconProps) => (
    <svg viewBox="0 0 24 24" strokeWidth={1.8} {...s} {...p}>
      <path d="M3 9 4.5 4h15L21 9" />
      <path d="M3 9h18v2a3 3 0 0 1-6 0 3 3 0 0 1-6 0 3 3 0 0 1-6 0V9z" />
      <path d="M4 11v9h16v-9" />
      <path d="M9 20v-5h6v5" />
    </svg>
  ),
  help: (p: IconProps) => (
    <svg viewBox="0 0 24 24" strokeWidth={1.8} {...s} {...p}>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.2 9a2.8 2.8 0 0 1 5.4 1c0 1.8-2.6 2.2-2.6 4" />
      <path d="M12 17h.01" />
    </svg>
  ),
  coffee: (p: IconProps) => (
    <svg viewBox="0 0 24 24" strokeWidth={1.8} {...s} {...p}>
      <path d="M17 8h2a3 3 0 0 1 0 6h-2" />
      <path d="M3 8h14v6a5 5 0 0 1-5 5H8a5 5 0 0 1-5-5V8z" />
      <path d="M6 2c0 1-1 1.5-1 2.5M10 2c0 1-1 1.5-1 2.5M14 2c0 1-1 1.5-1 2.5" />
    </svg>
  ),
  inbox: (p: IconProps) => (
    <svg viewBox="0 0 24 24" strokeWidth={1.7} {...s} {...p}>
      <path d="M22 12h-6l-2 3h-4l-2-3H2" />
      <path d="M5.5 5.5 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.5-6.5A2 2 0 0 0 16.7 4H7.3a2 2 0 0 0-1.8 1.5z" />
    </svg>
  ),
  ext: (p: IconProps) => (
    <svg viewBox="0 0 24 24" strokeWidth={1.8} {...s} {...p}>
      <path d="M15 3h6v6" />
      <path d="M10 14 21 3" />
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
    </svg>
  ),
  lock: (p: IconProps) => (
    <svg viewBox="0 0 24 24" strokeWidth={1.8} {...s} {...p}>
      <rect x="4.5" y="10.5" width="15" height="10" rx="2.2" />
      <path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" />
    </svg>
  ),
  search: (p: IconProps) => (
    <svg viewBox="0 0 24 24" strokeWidth={1.8} {...s} {...p}>
      <circle cx="11" cy="11" r="7" />
      <path d="m21 21-4.3-4.3" />
    </svg>
  ),
  receipt: (p: IconProps) => (
    <svg viewBox="0 0 24 24" strokeWidth={1.7} {...s} {...p}>
      <path d="M5 3v18l2-1.4 2 1.4 2-1.4 2 1.4 2-1.4 2 1.4V3l-2 1.4L13 3l-2 1.4L9 3 7 4.4 5 3z" />
      <path d="M8.5 8.5h7M8.5 12h7" />
    </svg>
  ),
  wand: (p: IconProps) => (
    <svg viewBox="0 0 24 24" strokeWidth={1.8} {...s} {...p}>
      <path d="m15 4 1 2 2 1-2 1-1 2-1-2-2-1 2-1 1-2z" />
      <path d="M5 19 14.5 9.5l-1-1L4 18z" />
      <path d="M19 13l.6 1.2 1.4.6-1.4.6-.6 1.4-.6-1.4-1.4-.6 1.4-.6.6-1.2z" />
    </svg>
  ),
} satisfies Record<string, IconComponent>;

export type IconName = keyof typeof Icon;
