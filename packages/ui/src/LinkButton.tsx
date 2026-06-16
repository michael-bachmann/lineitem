import type { AnchorHTMLAttributes, ReactNode } from "react";
import { BASE, SIZE, type ButtonVariant } from "./Button";

// Same looks as <Button>, but with plain `hover:`/`active:` — an <a> is never
// `:disabled`, so it needs neither the `enabled:` guard nor the disabled styles.
const VARIANT: Record<ButtonVariant, string> = {
  secondary: "bg-surface-2 text-text border-line-strong hover:bg-surface-3",
  primary: "bg-ink text-ink-fg border-transparent hover:[filter:brightness(1.4)]",
  ghost: "bg-transparent text-muted border-line hover:bg-surface hover:text-text",
  danger:
    "bg-[var(--btn-danger-bg)] border-[var(--btn-danger-line)] text-[var(--btn-danger-text)] hover:bg-[var(--btn-danger-bg-hover)]",
};

interface LinkButtonProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  variant?: ButtonVariant;
  sm?: boolean;
  children?: ReactNode;
}

/** An anchor styled as a <Button> — for link CTAs (nav, store, coffee). */
export function LinkButton({
  variant = "secondary",
  sm = false,
  className = "",
  children,
  ...rest
}: LinkButtonProps) {
  return (
    <a
      {...rest}
      // Re-add the active press: BASE's is `enabled:active:` which never matches an <a>.
      className={`${BASE} active:translate-y-px no-underline ${sm ? SIZE.sm : SIZE.default} ${VARIANT[variant]} ${className}`}
    >
      {children}
    </a>
  );
}
