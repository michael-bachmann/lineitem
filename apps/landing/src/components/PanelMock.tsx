import type { ReactNode } from "react";
import { Button, Icon, Mark } from "@lineitem/ui";

type Variant = "detail" | "queue";

/** One grouped charge in the `queue` variant. */
function QueueCard({
  dot,
  payee,
  amount,
  status,
  date,
}: {
  dot: "ok" | "attention";
  payee: string;
  amount: string;
  status: string;
  date: string;
}) {
  return (
    <div className="flex flex-col gap-[6px] rounded-[12px] border border-line bg-surface px-3 py-[11px] shadow-card">
      <div className="flex items-center gap-2">
        <span className={`h-[7px] w-[7px] flex-none rounded-full ${dot === "ok" ? "bg-ok" : "bg-brand"}`} />
        <span className="truncate text-[13.5px] font-semibold text-text">{payee}</span>
        <span className="ml-auto flex-none text-[14px] font-[650] text-text tabular">{amount}</span>
      </div>
      <div className="flex items-baseline gap-2 pl-[15px]">
        <span className="mr-auto truncate text-[12px] text-muted">{status}</span>
        <span className="flex-none text-[11.5px] text-faint tabular">{date}</span>
      </div>
    </div>
  );
}

/** One itemized line in the `detail` variant: product swatch + title/price + category. */
function ItemRow({ title, price, category }: { title: string; price: string; category: string }) {
  return (
    <div className="flex items-center gap-[10px] rounded-[12px] border border-line bg-surface px-[10px] py-[9px] shadow-card">
      {/* The real product shows an Amazon photo here; the mock uses the product's
          own swatch frame (--swatch-* tokens) + box glyph — its honest "no image"
          state — so we never ship third-party product photography. */}
      <span
        className="grid h-[34px] w-[34px] flex-none place-items-center rounded-[8px] border text-faint shadow-[inset_0_1px_0_rgba(255,255,255,.5),inset_0_0_0_1px_rgba(0,0,0,.03)]"
        style={{ background: "var(--swatch-bg)", borderColor: "var(--swatch-ring)" }}
      >
        <Icon.box width={18} height={18} className="opacity-70" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[12.5px] font-semibold leading-[1.25] text-text">{title}</div>
        <div className="mt-[2px] text-[11.5px] text-faint tabular">{price}</div>
      </div>
      <span className="flex-none rounded-pill border border-ok-line bg-ok-weak px-2 py-[2px] text-[11px] font-semibold text-ok-text">
        {category}
      </span>
    </div>
  );
}

/** Shared phone-panel shell: chrome bar + body. `inert` + aria-hidden because the
 *  whole thing is a decorative screenshot, not live UI. */
function Shell({ className, children }: { className: string; children: ReactNode }) {
  return (
    <div
      inert
      aria-hidden
      className={`overflow-hidden rounded-[22px] border border-line bg-surface shadow-mock ${className}`}
    >
      <div className="flex h-[30px] items-center gap-[6px] border-b border-line bg-surface-2 px-3">
        <span className="h-2 w-2 rounded-full bg-line-strong" />
        <span className="h-2 w-2 rounded-full bg-line-strong" />
        <span className="h-2 w-2 rounded-full bg-line-strong" />
        <span className="ml-auto text-[10.5px] text-faint">Side panel</span>
      </div>
      <div className="flex flex-col gap-[10px] bg-bg p-[14px]">{children}</div>
    </div>
  );
}

/**
 * Static replica of the extension side panel — purely decorative.
 * - `detail`: one charge cracked open into itemized, categorized line items (hero —
 *   proves the headline).
 * - `queue`: the grouped review queue (how-it-works — shows the workflow).
 */
export default function PanelMock({ variant }: { variant: Variant }) {
  if (variant === "detail") {
    return (
      <Shell className="w-full max-w-[340px] rotate-[0.6deg]">
        <div className="text-[12px] font-semibold text-link">← Back to queue</div>

        <div className="rounded-[12px] border border-line bg-gradient-to-b from-surface-2 to-surface px-[13px] py-3 shadow-card">
          <div className="flex items-baseline justify-between">
            <span className="text-[22px] font-extrabold tracking-[-0.02em] text-text tabular">$42.98</span>
            <span className="text-[11.5px] text-faint tabular">May 20</span>
          </div>
          <div className="mt-1 text-[13px] font-semibold text-text">AMAZON.COM</div>
          <div className="mt-[1px] text-[11px] text-faint tabular">Order 112-7654321</div>
        </div>

        <span className="text-[10px] font-bold uppercase tracking-[0.08em] text-faint">3 items</span>
        <ItemRow title="Blue Diamond Almonds, 40oz" price="$14.99 × 2" category="Groceries" />
        <ItemRow title="Seventh Gen Dish Soap" price="$7.49" category="Household" />
        <ItemRow title="USB-C Cable, 6ft Braided" price="$5.51" category="Electronics" />

        <div className="flex flex-col gap-[5px] rounded-[12px] border border-line bg-surface px-[13px] py-[11px] shadow-card">
          <div className="flex justify-between text-[12.5px] text-muted">
            <span>Groceries</span>
            <span className="text-text tabular">$29.98</span>
          </div>
          <div className="flex justify-between text-[12.5px] text-muted">
            <span>Household</span>
            <span className="text-text tabular">$7.49</span>
          </div>
          <div className="flex justify-between text-[12.5px] text-muted">
            <span>Electronics</span>
            <span className="text-text tabular">$5.51</span>
          </div>
          <div className="mt-[2px] flex justify-between border-t border-dashed border-line-strong pt-[7px] text-[13.5px] font-bold text-text">
            <span>Total</span>
            <span className="tabular">$42.98</span>
          </div>
        </div>

        <Button variant="primary" className="mt-[2px]">
          Approve &amp; write split
        </Button>
      </Shell>
    );
  }

  return (
    <Shell className="w-full max-w-[320px] rotate-[-0.6deg]">
      <div className="flex items-center gap-2">
        <Mark size={24} />
        <span className="text-[15px] font-bold tracking-[-0.02em] text-text">lineitem</span>
        <Button variant="primary" sm className="ml-auto">
          <Icon.sync width={14} height={14} /> Sync
        </Button>
      </div>

      <span className="text-[10px] font-bold uppercase tracking-[0.08em] text-faint">Needs review</span>
      <QueueCard
        dot="attention"
        payee="AMAZON GROCERY"
        amount="$42.99"
        status="1 item needs a category"
        date="May 20"
      />

      <span className="text-[10px] font-bold uppercase tracking-[0.08em] text-faint">Ready to approve</span>
      <QueueCard dot="ok" payee="AMAZON.COM" amount="$42.98" status="Ready to approve" date="May 20" />
      <QueueCard dot="ok" payee="TARGET" amount="+$24.50" status="Refund · ready" date="May 19" />

      <Button variant="primary" className="mt-[2px]">
        Approve all ready (2)
      </Button>
    </Shell>
  );
}
