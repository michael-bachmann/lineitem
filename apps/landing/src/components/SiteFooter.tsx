import { Mark, type FeedbackKind } from "@lineitem/ui";
import { Wrap } from "./Wrap";
import { LINKS, PRIVACY_PATH, VERSION } from "@/lib/links";

type FooterItem = { label: string } & (
  | { href: string; external?: boolean }
  | { feedback: FeedbackKind }
);

interface Col {
  heading: string;
  items: FooterItem[];
}

const COLS: Col[] = [
  {
    heading: "Product",
    items: [
      { label: "Add to Chrome", href: "/#install" },
      { label: "Add to Firefox", href: "/#install" },
      { label: "How it works", href: "/#how" },
      { label: "FAQ", href: "/#faq" },
    ],
  },
  {
    heading: "Project",
    items: [
      { label: "README & docs", href: LINKS.readme, external: true },
      { label: "Report an issue", feedback: "issue" },
      { label: "Make a suggestion", feedback: "suggestion" },
      { label: "Request a retailer", feedback: "retailer" },
    ],
  },
  {
    heading: "Support",
    items: [
      { label: "Buy me a coffee", href: LINKS.coffee, external: true },
      { label: "Privacy Policy", href: PRIVACY_PATH },
      { label: "YNAB", href: LINKS.ynab, external: true },
    ],
  },
];

const ITEM = "text-left text-[14.5px] text-muted transition-colors hover:text-text";

function FooterItemLink({ item, onFeedback }: { item: FooterItem; onFeedback: (k: FeedbackKind) => void }) {
  if ("feedback" in item) {
    return (
      <button type="button" onClick={() => onFeedback(item.feedback)} className={ITEM}>
        {item.label}
      </button>
    );
  }
  return (
    <a
      href={item.href}
      {...(item.external ? { target: "_blank", rel: "noreferrer" } : {})}
      className={ITEM}
    >
      {item.label}
    </a>
  );
}

/** Site footer: brand blurb + Product/Project/Support columns + legal row. */
export default function SiteFooter({ onFeedback }: { onFeedback: (kind: FeedbackKind) => void }) {
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
            <div key={col.heading} className="flex flex-col items-start gap-[11px]">
              <span className="mb-[3px] text-[12px] font-bold uppercase tracking-[0.1em] text-faint">
                {col.heading}
              </span>
              {col.items.map((item) => (
                <FooterItemLink key={item.label} item={item} onFeedback={onFeedback} />
              ))}
            </div>
          ))}
        </div>
      </Wrap>
      <Wrap className="mt-10 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-line pt-[22px] text-[13px] text-faint">
        <span className="min-w-0">© 2026 lineitem · Not affiliated with YNAB, Amazon, or Target</span>
        <span className="tabular">{VERSION}</span>
      </Wrap>
    </footer>
  );
}
