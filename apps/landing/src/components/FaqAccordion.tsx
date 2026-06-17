import { Icon } from "@lineitem/ui";
import type { FaqEntry } from "@/lib/faq";

/** One native <details> FAQ row with a rotating chevron. */
export function FaqItem({ q, a, defaultOpen = false }: FaqEntry & { defaultOpen?: boolean }) {
  return (
    <details open={defaultOpen} className="group border-b border-line last:border-b-0">
      <summary className="flex cursor-pointer list-none items-center gap-[14px] px-5 py-[18px] text-[16px] font-semibold text-text [&::-webkit-details-marker]:hidden">
        {q}
        <Icon.chevR
          aria-hidden
          width={14}
          height={14}
          className="ml-auto flex-none text-faint transition-transform group-open:rotate-90"
        />
      </summary>
      <div className="px-5 pb-[18px] text-[15px] leading-[1.6] text-muted">{a}</div>
    </details>
  );
}

/** Native-<details> FAQ accordion; the first item starts expanded. */
export function FaqAccordion({ items }: { items: FaqEntry[] }) {
  return (
    <div className="mx-auto max-w-[680px] overflow-hidden rounded-card border border-line bg-surface shadow-card">
      {items.map((it, i) => (
        <FaqItem key={it.q} {...it} defaultOpen={i === 0} />
      ))}
    </div>
  );
}
