/** Currency amount with tabular figures so columns of numbers stay aligned
 *  (no monospace font — `.tabular` applies `font-variant-numeric`).
 *  `value` is the magnitude; pass `refund` to prefix "+" for a YNAB inflow. */
export function Money({
  value,
  refund = false,
  className = "",
}: {
  value: number;
  refund?: boolean;
  className?: string;
}) {
  return (
    <span className={`tabular tracking-[-0.005em] ${className}`}>
      {refund ? "+" : ""}${value.toFixed(2)}
    </span>
  );
}
