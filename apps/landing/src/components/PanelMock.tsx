import { Icon, Mark } from "@lineitem/ui";

function PanelCard({
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

/** Static replica of the extension's queue side panel — purely decorative. */
export default function PanelMock() {
  return (
    <div
      aria-hidden
      className="w-full max-w-[340px] rotate-[0.6deg] overflow-hidden rounded-[22px] border border-line bg-surface shadow-mock"
    >
      <div className="flex h-[30px] items-center gap-[6px] border-b border-line bg-surface-2 px-3">
        <span className="h-2 w-2 rounded-full bg-line-strong" />
        <span className="h-2 w-2 rounded-full bg-line-strong" />
        <span className="h-2 w-2 rounded-full bg-line-strong" />
        <span className="ml-auto text-[10.5px] text-faint">Side panel</span>
      </div>

      <div className="flex flex-col gap-[10px] bg-bg p-[14px]">
        <div className="flex items-center gap-2">
          <Mark size={24} />
          <span className="text-[15px] font-bold tracking-[-0.02em] text-text">lineitem</span>
          <span className="ml-auto inline-flex items-center gap-[5px] rounded-[8px] bg-ink px-[10px] py-[6px] text-[12px] font-semibold text-ink-fg">
            <Icon.sync width={12} height={12} /> Sync
          </span>
        </div>

        <span className="text-[10px] font-bold uppercase tracking-[0.08em] text-faint">Needs review</span>
        <PanelCard
          dot="attention"
          payee="AMAZON GROCERY"
          amount="$42.99"
          status="1 item needs a category"
          date="May 20"
        />

        <span className="text-[10px] font-bold uppercase tracking-[0.08em] text-faint">Ready to approve</span>
        <PanelCard dot="ok" payee="AMAZON.COM" amount="$42.98" status="Ready to approve" date="May 20" />
        <PanelCard dot="ok" payee="TARGET" amount="+$24.50" status="Refund · ready" date="May 19" />

        <div className="mt-[2px] rounded-[10px] bg-ink py-[10px] text-center text-[13px] font-semibold text-ink-fg">
          Approve all ready (2)
        </div>
      </div>
    </div>
  );
}
