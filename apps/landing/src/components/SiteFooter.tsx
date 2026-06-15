import type { ReactNode } from "react";
import { Mark } from "@lineitem/ui";
import { Wrap } from "./Wrap";
import { LINKS, VERSION } from "@/lib/links";

interface Col {
  heading: string;
  links: { label: string; href: string; external?: boolean }[];
}

// Project-column feedback items currently link to GitHub issues; PR6 wires them
// to the FeedbackModal once the page owns its open-state.
const COLS: Col[] = [
  {
    heading: "Product",
    links: [
      { label: "Add to Chrome", href: "#install" },
      { label: "Add to Firefox", href: "#install" },
      { label: "How it works", href: "#how" },
      { label: "FAQ", href: "#faq" },
    ],
  },
  {
    heading: "Project",
    links: [
      { label: "README & docs", href: LINKS.readme, external: true },
      { label: "Report an issue", href: LINKS.issues, external: true },
      { label: "Request a retailer", href: LINKS.issues, external: true },
    ],
  },
  {
    heading: "Support",
    links: [
      { label: "Buy me a coffee", href: LINKS.coffee, external: true },
      { label: "YNAB", href: LINKS.ynab, external: true },
    ],
  },
];

function FooterLink({ label, href, external }: Col["links"][number]): ReactNode {
  return (
    <a
      href={href}
      {...(external ? { target: "_blank", rel: "noreferrer" } : {})}
      className="text-[14.5px] text-muted transition-colors hover:text-text"
    >
      {label}
    </a>
  );
}

/** Site footer: brand blurb + Product/Project/Support columns + legal row. */
export default function SiteFooter() {
  return (
    <footer className="border-t border-line bg-surface pb-7 pt-12">
      <Wrap className="grid grid-cols-1 gap-10 min-[861px]:grid-cols-[1.2fr_2fr]">
        <div>
          <a href="#top" className="inline-flex items-center gap-[9px]">
            <Mark size={24} className="rounded-[8px]" />
            <span className="text-[18px] font-bold lowercase tracking-[-0.02em] text-text">
              lineitem
            </span>
          </a>
          <p className="mt-[10px] max-w-[22em] text-[14px] text-muted">
            Itemize your online orders in YNAB.
          </p>
        </div>
        <div className="grid grid-cols-3 gap-7 max-[620px]:grid-cols-2">
          {COLS.map((col) => (
            <div key={col.heading} className="flex flex-col gap-[11px]">
              <span className="mb-[3px] text-[12px] font-bold uppercase tracking-[0.1em] text-faint">
                {col.heading}
              </span>
              {col.links.map((l) => (
                <FooterLink key={l.label} {...l} />
              ))}
            </div>
          ))}
        </div>
      </Wrap>
      <Wrap className="mt-10 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-line pt-[22px] text-[13px] text-faint">
        <span className="min-w-0">© 2026 LineItem · Not affiliated with YNAB, Amazon, or Target</span>
        <span className="tabular">{VERSION}</span>
      </Wrap>
    </footer>
  );
}
