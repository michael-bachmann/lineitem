interface SpinnerProps {
  /** Diameter in px (15 default; 16 in tiles, 11 in chips). */
  size?: number;
  /** White spinner for use on a colored/primary surface. */
  onAccent?: boolean;
  className?: string;
}

/** Rotating ring spinner (token-driven border colors). */
export function Spinner({ size = 15, onAccent = false, className = "" }: SpinnerProps) {
  return (
    <span
      role="status"
      aria-label="Loading"
      className={`inline-block shrink-0 animate-spin rounded-full border-2 [animation-duration:0.7s] ${className}`}
      style={{
        width: size,
        height: size,
        borderColor: onAccent
          ? "rgba(255,255,255,.4)"
          : "color-mix(in oklab, var(--muted) 35%, transparent)",
        borderTopColor: onAccent ? "#fff" : "var(--muted)",
      }}
    />
  );
}
