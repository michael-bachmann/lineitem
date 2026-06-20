import type { ReactNode } from "react";
import { Icon } from "@lineitem/ui";

/** Generic prose/legal page layout — back-link, title, "last updated" date, then
 *  the section children. Built to host any legal page (Privacy now, Terms later);
 *  the `.legal-*` styles in the design reference are the source of truth. */
export function LegalPage({
  title,
  updated,
  backHref = "/",
  backLabel = "Back to home",
  children,
}: {
  title: string;
  /** Human-readable "last updated" date, e.g. "June 20, 2026". */
  updated: string;
  backHref?: string;
  backLabel?: string;
  children: ReactNode;
}) {
  return (
    <main className="mx-auto w-full max-w-[720px] px-6 pb-[72px] pt-14">
      <a
        href={backHref}
        className="mb-5 inline-flex items-center gap-[7px] text-[14.5px] font-semibold text-link transition-[filter] hover:brightness-110"
      >
        <Icon.arrowLeft width={16} height={16} className="flex-none" />
        {backLabel}
      </a>

      <div className="mb-8 border-b border-line pb-7">
        <h1 className="text-[clamp(30px,4.4vw,42px)] font-extrabold tracking-[-0.03em] text-text">
          {title}
        </h1>
        <p className="mt-3 text-[14px] text-faint">Last updated {updated}</p>
      </div>

      {children}
    </main>
  );
}

/** Brand-tinted "short version" callout at the top of a legal page. */
export function LegalTldr({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mb-9 flex items-start gap-[14px] rounded-card border border-[color:var(--brand-line)] bg-[linear-gradient(135deg,color-mix(in_oklab,var(--brand)_12%,var(--surface)),var(--surface))] px-[22px] py-5 shadow-card">
      <span className="flex h-[38px] w-[38px] flex-none items-center justify-center rounded-[11px] bg-brand text-white">
        <Icon.shield aria-hidden width={20} height={20} />
      </span>
      <div>
        <h2 className="mb-[5px] mt-[2px] text-[16px] font-bold text-text">{title}</h2>
        <p className="text-[14.5px] leading-[1.6] text-muted [&_b]:font-[650] [&_b]:text-text">
          {children}
        </p>
      </div>
    </div>
  );
}

/** A titled section of prose. Descendant `<p>`, `<h3>`, `<a>`, `<b>` are styled
 *  here so section bodies read as plain markup (matching the reference HTML). */
export function LegalSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mb-[34px] [&_a:hover]:underline [&_a]:font-semibold [&_a]:text-link [&_b]:font-[650] [&_b]:text-text [&_h3]:mb-2 [&_h3]:mt-5 [&_h3]:text-[16px] [&_h3]:font-bold [&_h3]:text-text [&_p:last-child]:mb-0 [&_p]:mb-3 [&_p]:text-[16px] [&_p]:leading-[1.7] [&_p]:text-muted">
      <h2 className="mb-3 text-[20px] font-bold tracking-[-0.02em] text-text">{title}</h2>
      {children}
    </section>
  );
}

/** Bulleted list with brand dots; `<b>` inside an item is emphasized. */
export function LegalList({ children }: { children: ReactNode }) {
  return (
    <ul className="mb-3 flex list-none flex-col gap-[11px] p-0 [&_b]:font-[650] [&_b]:text-text [&>li]:relative [&>li]:pl-7 [&>li]:text-[16px] [&>li]:leading-[1.6] [&>li]:text-muted [&>li]:before:absolute [&>li]:before:left-1 [&>li]:before:top-[9px] [&>li]:before:h-[7px] [&>li]:before:w-[7px] [&>li]:before:rounded-full [&>li]:before:bg-brand [&>li]:before:content-['']">
      {children}
    </ul>
  );
}

/** The "where your data goes" service/what/when grid. */
export function LegalTable({ head, rows }: { head: string[]; rows: ReactNode[][] }) {
  return (
    <table className="mb-[14px] mt-[6px] w-full border-collapse text-[14.5px]">
      <thead>
        <tr>
          {head.map((h) => (
            <th
              key={h}
              className="border-b border-line px-3 py-[11px] text-left align-top text-[12px] font-bold uppercase tracking-[0.07em] text-faint"
            >
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((cells, r) => (
          <tr key={r}>
            {cells.map((cell, c) => (
              <td
                key={c}
                className="border-b border-line px-3 py-[11px] text-left align-top leading-[1.5] text-muted first:whitespace-nowrap first:font-semibold first:text-text"
              >
                {cell}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Sage, reassuring "no trackers" callout. */
export function LegalCallout({ children }: { children: ReactNode }) {
  return (
    <div className="my-[4px] mb-[14px] flex items-start gap-[11px] rounded-control border border-ok-line bg-ok-weak px-4 py-[14px]">
      <Icon.check aria-hidden width={18} height={18} className="mt-px flex-none text-ok-text" />
      <p className="text-[14.5px] leading-[1.55] text-ok-text">{children}</p>
    </div>
  );
}
