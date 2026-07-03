import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ReactNode } from "react";
import { Mark } from "@lineitem/ui";
import DetailView from "./DetailView";
import QueueView from "./QueueView";
import type {
  AllocatedTransaction,
  Category,
  ClassifiedItem,
  OrderMatchStatus,
  QueueEntry,
} from "@/lib/types";

// Marketing-only stories that render the REAL side-panel UI seeded with clean,
// believable data, framed on a 1280x800 brand canvas for Chrome Web Store
// screenshots. Not shipped (stories are excluded from the extension build).
// Capture with: pnpm build-storybook, then headless Chrome at 1280x800 against
// the story's iframe.html?id=... URL.

// ---- brand-tinted product swatches (white bg so Thumb's mix-blend reads) ----
const COFFEE =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120'%3E%3Crect width='120' height='120' fill='white'/%3E%3Cpath d='M44 40 h32 v44 a5 5 0 0 1-5 5 h-22 a5 5 0 0 1-5-5 z' fill='%235c7c86'/%3E%3Crect x='44' y='40' width='32' height='9' fill='%234a666f'/%3E%3Crect x='53' y='60' width='14' height='17' rx='2' fill='white'/%3E%3C/svg%3E";
const TOWELS =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120'%3E%3Crect width='120' height='120' fill='white'/%3E%3Crect x='42' y='36' width='36' height='50' rx='18' fill='%23b5838d'/%3E%3Cellipse cx='60' cy='36' rx='18' ry='6' fill='%23cba7ad'/%3E%3Crect x='58' y='36' width='4' height='50' fill='%23a06e79' opacity='0.5'/%3E%3C/svg%3E";
const BOTTLE =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120'%3E%3Crect width='120' height='120' fill='white'/%3E%3Crect x='51' y='30' width='12' height='13' rx='2' fill='%236f9078'/%3E%3Crect x='45' y='43' width='24' height='44' rx='6' fill='%2384a98c'/%3E%3Crect x='49' y='57' width='16' height='16' rx='2' fill='white'/%3E%3C/svg%3E";

const CATEGORIES: Category[] = [
  { id: "groceries", name: "Groceries", groupName: "Frequent" },
  { id: "household", name: "Household Goods", groupName: "Non-Monthly" },
  { id: "personal", name: "Personal Care", groupName: "Non-Monthly" },
  { id: "coffee", name: "Coffee & Snacks", groupName: "Fun Money" },
];

function item(
  productId: string,
  title: string,
  imageUrl: string,
  cents: number,
  suggested: string,
): ClassifiedItem {
  return {
    productId,
    title,
    imageUrl,
    unitPriceCents: cents,
    quantity: 1,
    refundedAmountCents: 0,
    allocatedCents: cents,
    suggestedCategoryId: suggested,
    classificationSource: "product_cache",
  } as ClassifiedItem;
}

// A tidy 3-item Amazon order, every item already categorized → the panel shows
// the ready "Approve & write split" state and the full split breakdown.
const HERO_ITEMS: ClassifiedItem[] = [
  item("h1", "Organic Whole Bean Coffee, Medium Roast 2 lb", COFFEE, 1899, "coffee"),
  item("h2", "Bounty Paper Towels, 12 Double Rolls", TOWELS, 2449, "household"),
  item("h3", "Cetaphil Gentle Skin Cleanser, 16 fl oz", BOTTLE, 1399, "personal"),
];

const heroOrder = {
  ynabTransactionId: "h",
  orderKey: "amazon:114-3921576-8830247",
  retailer: "amazon",
  date: "2026-06-14",
  amountCents: 5747,
  isRefund: false,
  items: HERO_ITEMS,
} as AllocatedTransaction;

const heroEntry: QueueEntry = {
  ynabTransaction: {
    id: "h",
    payee_name: "AMAZON.COM",
    amount: -57470,
    date: "2026-06-14",
  } as QueueEntry["ynabTransaction"],
  retailer: "amazon",
  matchStatus: { status: "matched", order: heroOrder, classifiedItems: HERO_ITEMS },
};

// ---- queue fixture: a clean list of matched, ready-to-split charges ----
const cat = (id: string) => ({ suggestedCategoryId: id }) as ClassifiedItem;
const order = {} as Extract<OrderMatchStatus, { status: "matched" }>["order"];
const matched = (items: ClassifiedItem[]): OrderMatchStatus => ({
  status: "matched",
  order,
  classifiedItems: items,
});

function qentry(id: string, payee: string, dollars: number, items: ClassifiedItem[]): QueueEntry {
  return {
    ynabTransaction: {
      id,
      payee_name: payee,
      amount: -Math.round(dollars * 1000),
      date: "2026-06-14",
    } as QueueEntry["ynabTransaction"],
    retailer: payee.startsWith("TARGET") ? "target" : "amazon",
    matchStatus: matched(items),
  };
}

const QUEUE: QueueEntry[] = [
  qentry("1", "AMAZON.COM", 57.47, [cat("coffee"), cat("household"), cat("personal")]),
  qentry("2", "TARGET", 34.18, [cat("groceries"), cat("household")]),
  qentry("3", "AMAZON.COM", 21.99, [cat("personal")]),
  qentry("4", "TARGET", 42.6, [cat("groceries"), cat("household"), cat("groceries")]),
];

const noop = () => {};

// ---- 1280x800 brand canvas ----
function Frame({
  caption,
  sub,
  scale = 1,
  children,
}: {
  caption: ReactNode;
  sub: string;
  scale?: number;
  children: ReactNode;
}) {
  return (
    <div
      style={{
        width: 1280,
        height: 800,
        position: "fixed",
        top: 0,
        left: 0,
        overflow: "hidden",
        fontFamily: "var(--font-sans)",
        background: "linear-gradient(155deg, #f8eff1 0%, #f4f1ec 46%, #e8f0ed 100%)",
      }}
    >
      {/* Storybook panels use min-h-screen; neutralize it so the panel takes its
          natural content height inside the rounded frame (button stays visible). */}
      <style>{`.shot-panel > div{min-height:0 !important}`}</style>
      <div
        style={{
          position: "absolute", width: 440, height: 440, left: -130, top: -150,
          borderRadius: "50%", background: "#b5838d", opacity: 0.14, filter: "blur(65px)",
        }}
      />
      <div
        style={{
          position: "absolute", width: 480, height: 480, right: -150, bottom: -170,
          borderRadius: "50%", background: "#84a98c", opacity: 0.15, filter: "blur(75px)",
        }}
      />
      <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", gap: 60, padding: "0 92px" }}>
        <div style={{ flex: "1 1 0", maxWidth: 520 }}>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
            <Mark size={32} className="rounded-[9px]" />
            <span style={{ fontSize: 23, fontWeight: 800, letterSpacing: "-0.02em", color: "#2f2a33" }}>
              lineitem
            </span>
          </div>
          <div style={{ marginTop: 30, fontSize: 13, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: "#9c5f6c" }}>
            Amazon &amp; Target → YNAB
          </div>
          <h1 style={{ margin: "14px 0 0", fontSize: 52, lineHeight: 1.06, fontWeight: 800, letterSpacing: "-0.025em", color: "#2f2a33" }}>
            {caption}
          </h1>
          <p style={{ margin: "20px 0 0", fontSize: 19, lineHeight: 1.55, color: "#6d6875", maxWidth: "19em" }}>
            {sub}
          </p>
        </div>
        <div
          className="shot-panel"
          style={{
            width: 392, flex: "none", borderRadius: 24, overflow: "hidden",
            border: "1px solid rgba(47,42,51,0.08)",
            boxShadow: "0 34px 64px -22px rgba(47,42,51,0.38), 0 10px 26px -10px rgba(47,42,51,0.22)",
            transform: scale !== 1 ? `scale(${scale})` : undefined,
          }}
        >
          {children}
        </div>
      </div>
    </div>
  );
}

const meta = { title: "Store/Screenshots" } satisfies Meta;
export default meta;
type Story = StoryObj;

export const Hero: Story = {
  render: () => (
    <Frame
      caption={
        <>
          One charge,
          <br />
          every category.
        </>
      }
      sub="lineitem reads the real items in your Amazon and Target orders and splits each YNAB transaction to match — line by line."
      scale={0.82}
    >
      <DetailView entry={heroEntry} categories={CATEGORIES} onBack={noop} onApprove={async () => {}} />
    </Frame>
  ),
};

export const Queue: Story = {
  render: () => (
    <Frame
      caption={
        <>
          Every order,
          <br />
          matched and ready.
        </>
      }
      sub="lineitem finds the Amazon and Target charges in your budget that still need categorizing, and lines them up to split."
    >
      <QueueView
        queue={QUEUE}
        syncing={false}
        approving={false}
        error={null}
        onSync={noop}
        onApproveAll={noop}
        onSelectEntry={noop}
        onSettings={noop}
        onOpenRetailer={noop}
      />
    </Frame>
  ),
};

const GRAD = "linear-gradient(155deg, #f8eff1 0%, #f4f1ec 46%, #e8f0ed 100%)";

// Small promo tile (440x280): a compact brand card — a UI panel would be too
// cramped at this size, so it's logo + tagline on the brand canvas.
export const PromoSmall: Story = {
  render: () => (
    <div
      style={{
        width: 440, height: 280, position: "fixed", top: 0, left: 0, overflow: "hidden",
        fontFamily: "var(--font-sans)", background: GRAD,
        display: "flex", flexDirection: "column", alignItems: "center",
        justifyContent: "center", textAlign: "center", padding: "0 34px",
      }}
    >
      <div style={{ position: "absolute", width: 220, height: 220, left: -70, top: -80, borderRadius: "50%", background: "#b5838d", opacity: 0.16, filter: "blur(45px)" }} />
      <div style={{ position: "absolute", width: 240, height: 240, right: -80, bottom: -90, borderRadius: "50%", background: "#84a98c", opacity: 0.16, filter: "blur(50px)" }} />
      <div style={{ position: "relative", display: "inline-flex", alignItems: "center", gap: 9, marginBottom: 16 }}>
        <Mark size={30} className="rounded-[8px]" />
        <span style={{ fontSize: 24, fontWeight: 800, letterSpacing: "-0.02em", color: "#2f2a33" }}>lineitem</span>
      </div>
      <h2 style={{ position: "relative", margin: 0, fontSize: 27, lineHeight: 1.12, fontWeight: 800, letterSpacing: "-0.02em", color: "#2f2a33" }}>
        One charge,
        <br />
        every category.
      </h2>
      <p style={{ position: "relative", margin: "12px 0 0", fontSize: 13.5, lineHeight: 1.4, color: "#6d6875" }}>
        Split your Amazon &amp; Target orders in YNAB.
      </p>
    </div>
  ),
};

// Marquee promo tile (1400x560): wide brand message on the left, the queue
// panel on the right (short enough to fit 560px tall).
export const PromoMarquee: Story = {
  render: () => (
    <div style={{ width: 1400, height: 560, position: "fixed", top: 0, left: 0, overflow: "hidden", fontFamily: "var(--font-sans)", background: GRAD }}>
      <style>{`.shot-panel > div{min-height:0 !important}`}</style>
      <div style={{ position: "absolute", width: 360, height: 360, left: -110, top: -130, borderRadius: "50%", background: "#b5838d", opacity: 0.15, filter: "blur(60px)" }} />
      <div style={{ position: "absolute", width: 400, height: 400, right: -130, bottom: -150, borderRadius: "50%", background: "#84a98c", opacity: 0.16, filter: "blur(65px)" }} />
      <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", gap: 56, padding: "0 84px" }}>
        <div style={{ flex: "1 1 0", maxWidth: 640 }}>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
            <Mark size={34} className="rounded-[9px]" />
            <span style={{ fontSize: 24, fontWeight: 800, letterSpacing: "-0.02em", color: "#2f2a33" }}>lineitem</span>
          </div>
          <div style={{ marginTop: 22, fontSize: 13, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: "#9c5f6c" }}>
            Amazon &amp; Target → YNAB
          </div>
          <h1 style={{ margin: "12px 0 0", fontSize: 46, lineHeight: 1.07, fontWeight: 800, letterSpacing: "-0.025em", color: "#2f2a33" }}>
            One charge,
            <br />
            every category.
          </h1>
          <p style={{ margin: "16px 0 0", fontSize: 18, lineHeight: 1.5, color: "#6d6875", maxWidth: "22em" }}>
            lineitem splits each Amazon and Target charge into the right budget categories — from the real items, line by line.
          </p>
        </div>
        <div
          className="shot-panel"
          style={{
            width: 392, flex: "none", borderRadius: 22, overflow: "hidden",
            border: "1px solid rgba(47,42,51,0.08)",
            boxShadow: "0 30px 60px -22px rgba(47,42,51,0.36), 0 10px 26px -10px rgba(47,42,51,0.2)",
          }}
        >
          <QueueView
            queue={QUEUE}
            syncing={false}
            approving={false}
            error={null}
            onSync={noop}
            onApproveAll={noop}
            onSelectEntry={noop}
            onSettings={noop}
            onOpenRetailer={noop}
          />
        </div>
      </div>
    </div>
  ),
};
