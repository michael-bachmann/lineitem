import type { BlockedRetailer } from "@/lib/types";
import { retailerLabel } from "@/lib/registry";
import { plural } from "@/lib/intl";
import { Button, Icon } from "@lineitem/ui";

function title(b: BlockedRetailer): string {
  const name = retailerLabel(b.retailer);
  return b.reason === "step_up" ? `Finish signing in to ${name}` : `Sign in to ${name}`;
}

function subtitle(b: BlockedRetailer): string {
  const charges = `${b.count} ${plural(b.count, { one: "charge", other: "charges" })}`;
  return b.reason === "step_up"
    ? `${retailerLabel(b.retailer)} needs a quick re-sign-in to read ${charges}. Sign in, then tap Sync.`
    : `You’re signed out, so ${charges} couldn’t be read. Sign in, then tap Sync.`;
}

interface ResolutionCardProps {
  blocked: BlockedRetailer[];
  onOpenRetailer: (retailer: string, url?: string) => void;
}

/**
 * "Needs you" card above the queue: one row per retailer that hit a sign-in
 * wall (signed out, or a mid-walk step-up). Opening the retailer foregrounds its
 * tab; resume is the existing Sync button once the user has signed in.
 */
export default function ResolutionCard({ blocked, onOpenRetailer }: ResolutionCardProps) {
  if (blocked.length === 0) return null;
  return (
    <div className="flex flex-col gap-3 rounded-card border border-attention-line bg-attention-weak p-4">
      {blocked.map((b) => (
        <div key={b.retailer} className="flex flex-col gap-[10px]">
          <div className="flex items-start gap-[10px]">
            <span className="flex h-[30px] w-[30px] flex-none items-center justify-center rounded-control bg-surface text-attention">
              <Icon.lock aria-hidden width={16} height={16} />
            </span>
            <div className="min-w-0">
              <h2 className="m-0 text-[14.5px] font-semibold tracking-[-0.01em] text-text">
                {title(b)}
              </h2>
              <p className="m-0 mt-[2px] text-[12.5px] leading-[1.5] text-muted">{subtitle(b)}</p>
            </div>
          </div>
          <Button variant="secondary" sm onClick={() => onOpenRetailer(b.retailer, b.url)}>
            <Icon.ext aria-hidden width={14} height={14} /> Open {retailerLabel(b.retailer)}
          </Button>
        </div>
      ))}
    </div>
  );
}
