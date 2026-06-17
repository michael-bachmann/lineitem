import { Icon, LinkButton } from "@lineitem/ui";
import { Wrap } from "./Wrap";
import { LINKS } from "@/lib/links";

/** "Enjoying LineItem?" support callout — the landing band variant of the
 *  extension's CoffeeCard (brand-tinted gradient, coffee icon, Ko-fi button). */
export default function CoffeeBand() {
  return (
    <section className="py-16 max-[620px]:py-12">
      <Wrap>
        <div className="mx-auto flex max-w-[680px] items-center justify-between gap-6 rounded-card border border-[var(--brand-line)] bg-[linear-gradient(135deg,color-mix(in_oklab,var(--brand)_14%,var(--surface)),var(--surface))] p-[26px] shadow-card max-[620px]:flex-col max-[620px]:items-start">
          <div className="flex items-center gap-4">
            <span
              aria-hidden
              className="flex h-12 w-12 flex-none items-center justify-center rounded-[13px] bg-brand text-ink-fg"
            >
              <Icon.coffee width={24} height={24} />
            </span>
            <div>
              <h3 className="text-[19px] font-bold tracking-[-0.02em] text-text">
                Enjoying LineItem?
              </h3>
              <p className="mt-[3px] max-w-[34em] text-[14.5px] leading-[1.5] text-muted">
                It's free and ad-free. A coffee keeps it maintained and the new retailers coming.
              </p>
            </div>
          </div>
          <LinkButton
            href={LINKS.coffee}
            target="_blank"
            rel="noopener noreferrer"
            variant="primary"
            className="flex-none min-[621px]:w-auto"
          >
            <Icon.coffee aria-hidden width={16} height={16} /> Buy me a coffee · $3
          </LinkButton>
        </div>
      </Wrap>
    </section>
  );
}
