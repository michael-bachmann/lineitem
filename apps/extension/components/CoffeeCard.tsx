import type { ReactNode } from "react";
import { LINKS } from "@/lib/help-content";
import { Button, Icon } from "@lineitem/ui";

interface CoffeeCardProps {
  /** Heading; defaults to the standing copy. */
  title?: string;
  /** Supporting line (string for the Help hero, a node for the bolded count). */
  sub: ReactNode;
  /** When provided, renders a top-right × (the post-approval instance). */
  onDismiss?: () => void;
  /** Fired when the Ko-fi button is clicked (used to soft-retire the ask). */
  onCoffeeClick?: () => void;
}

/** Donation ask, shared by the post-approval popup and the Help & About hero. */
export default function CoffeeCard({
  title = "Enjoying LineItem?",
  sub,
  onDismiss,
  onCoffeeClick,
}: CoffeeCardProps) {
  return (
    <div className="relative flex flex-col gap-3 rounded-card border border-line bg-surface p-[15px] shadow-card">
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          className="absolute right-[10px] top-[10px] flex h-[26px] w-[26px] items-center justify-center rounded-control text-faint hover:bg-surface-3 hover:text-muted"
        >
          <Icon.x aria-hidden width={15} height={15} />
        </button>
      )}
      <div className="flex items-center gap-[11px]">
        <span className="flex h-[38px] w-[38px] flex-none items-center justify-center rounded-control bg-brand-weak text-brand">
          <Icon.coffee aria-hidden width={20} height={20} />
        </span>
        <div>
          <div className="text-[15px] font-bold tracking-[-0.018em] text-text">{title}</div>
          <div className="text-[12.5px] leading-[1.45] text-muted">{sub}</div>
        </div>
      </div>
      <a
        href={LINKS.coffee}
        target="_blank"
        rel="noopener noreferrer"
        className="no-underline"
        onClick={onCoffeeClick}
      >
        <Button variant="primary">
          <Icon.coffee aria-hidden width={16} height={16} /> Buy me a coffee · $3
        </Button>
      </a>
    </div>
  );
}
