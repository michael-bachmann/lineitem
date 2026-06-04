/** Currency amount with tabular figures so columns of numbers stay aligned
 *  (no monospace font — `.tabular` applies `font-variant-numeric`). */
export function Money({ value, className = "" }: { value: number; className?: string }) {
  return <span className={`tabular tracking-[-0.005em] ${className}`}>${value.toFixed(2)}</span>;
}
