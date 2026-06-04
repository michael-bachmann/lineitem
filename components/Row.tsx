import type { ReactNode } from "react";
import { Icon } from "./icons";

interface RowProps {
  icon: ReactNode;
  title: string;
  sub: string;
  /** Brand-tinted icon badge (vs neutral). */
  accent?: boolean;
  /** External link → renders an <a> with an ↗ trailing icon. */
  href?: string;
  /** Internal navigation → renders a <button> with a › trailing icon. */
  onClick?: () => void;
}

const BASE =
  "flex w-full items-center gap-3 rounded-card border border-line bg-surface px-[14px] py-[13px] text-left shadow-card transition hover:border-line-strong hover:bg-surface-2 active:translate-y-px";

/** A settings/help list row: tinted icon badge + title/sub + trailing chevron
 *  (internal) or external-link glyph. */
export function Row({ icon, title, sub, accent = false, href, onClick }: RowProps) {
  const content = (
    <>
      <span
        className={`flex h-[34px] w-[34px] flex-none items-center justify-center rounded-control [&_svg]:h-[17px] [&_svg]:w-[17px] ${
          accent ? "bg-brand-weak text-brand" : "bg-surface-3 text-muted"
        }`}
      >
        {icon}
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-[2px]">
        <span className="text-[14px] font-semibold tracking-[-0.004em] text-text">{title}</span>
        <span className="text-[12px] leading-[1.4] text-faint">{sub}</span>
      </span>
      <span className="flex flex-none text-faint">
        {href ? (
          <Icon.ext aria-hidden width={14} height={14} />
        ) : (
          <Icon.chevR aria-hidden width={15} height={15} />
        )}
      </span>
    </>
  );

  if (href) {
    return (
      <a href={href} target="_blank" rel="noreferrer" className={`${BASE} no-underline`}>
        {content}
      </a>
    );
  }
  return (
    <button type="button" onClick={onClick} className={BASE}>
      {content}
    </button>
  );
}
