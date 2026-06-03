import type { ButtonHTMLAttributes } from "react";

/**
 * Compact icon-only button (the top-bar gear, and reused in Settings).
 * 38px tall, surface fill, pill radius in light mode. Distinct from `Button` —
 * it's a quiet affordance, not a primary/secondary action. Always pass an
 * `aria-label`.
 */
export default function IconButton({
  className = "",
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...rest}
      className={`inline-flex h-[38px] min-h-[38px] w-auto flex-none items-center justify-center rounded-pill border border-line bg-surface px-[10px] text-muted transition hover:border-line-strong hover:bg-surface-2 hover:text-text ${className}`}
    />
  );
}
