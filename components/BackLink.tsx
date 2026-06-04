import type { ButtonHTMLAttributes } from "react";
import { Icon } from "./icons";

interface BackLinkProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label?: string;
}

/** Back-navigation link (its own row) on detail, settings and help. */
export function BackLink({ label = "Back to queue", className = "", ...rest }: BackLinkProps) {
  return (
    <button
      {...rest}
      className={`inline-flex w-auto items-center gap-[7px] self-start whitespace-nowrap py-[2px] text-[14px] font-semibold text-link transition-all hover:gap-[9px] hover:[filter:brightness(1.12)] ${className}`}
    >
      <Icon.arrowLeft width={16} height={16} className="flex-none" />
      {label}
    </button>
  );
}
