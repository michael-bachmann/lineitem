import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Spinner } from "./Spinner";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  /** Compact 36px, auto-width variant (default is 44px, full-width). */
  sm?: boolean;
  /** Show a spinner and (optionally) swap the label while an action runs. */
  busy?: boolean;
  busyLabel?: ReactNode;
}

const BASE =
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-control border font-semibold tracking-[-0.005em] transition active:translate-y-px disabled:cursor-default";

const SIZE = {
  default: "min-h-[44px] w-full px-4 py-[11px] text-[14.5px]",
  sm: "min-h-[36px] w-auto px-[13px] py-2 text-[13px]",
};

const VARIANT: Record<ButtonVariant, string> = {
  secondary:
    "bg-surface-2 text-text border-line-strong hover:bg-surface-3 disabled:opacity-55",
  primary:
    "bg-ink text-ink-fg border-transparent hover:[filter:brightness(1.06)] disabled:opacity-100 disabled:bg-surface-2 disabled:text-faint disabled:border-line",
  ghost:
    "bg-transparent text-muted border-line hover:bg-surface hover:text-text disabled:opacity-55",
  danger:
    "bg-[color-mix(in_oklab,var(--danger)_14%,var(--surface))] border-[color-mix(in_oklab,var(--danger)_34%,transparent)] text-[color-mix(in_oklab,var(--danger)_90%,#000)] hover:bg-[color-mix(in_oklab,var(--danger)_22%,var(--surface))] disabled:opacity-55",
};

/** Primary action / form button. See variants in the design's primitive kit. */
export default function Button({
  variant = "secondary",
  sm = false,
  busy = false,
  busyLabel,
  children,
  className = "",
  disabled,
  ...rest
}: ButtonProps) {
  return (
    <button
      {...rest}
      disabled={disabled || busy}
      className={`${BASE} ${sm ? SIZE.sm : SIZE.default} ${VARIANT[variant]} ${className}`}
    >
      {busy && <Spinner size={15} onAccent={variant === "primary"} />}
      {busy && busyLabel ? busyLabel : children}
    </button>
  );
}
