import { LinkButton, Mark } from "@lineitem/ui";
import { Wrap } from "./Wrap";

const NAV_LINKS = [
  { href: "#how", label: "How it works" },
  { href: "#retailers", label: "Retailers" },
  { href: "#faq", label: "FAQ" },
];

/** Sticky top nav: brand + anchor links + install CTA. `scrolled` shows the
 *  bottom hairline once the page is scrolled (driven by App). */
export default function SiteNav({ scrolled = false }: { scrolled?: boolean }) {
  return (
    <header
      className={`sticky top-0 z-50 border-b bg-[color-mix(in_oklab,var(--bg)_86%,transparent)] backdrop-blur-[10px] transition-colors ${
        scrolled ? "border-line" : "border-transparent"
      }`}
    >
      <Wrap className="flex h-[66px] items-center gap-5">
        <a href="#top" aria-label="LineItem home" className="inline-flex items-center gap-[9px]">
          <Mark size={28} className="rounded-[8px]" />
          <span className="text-[19px] font-bold lowercase tracking-[-0.02em] text-text">
            lineitem
          </span>
        </a>

        <nav aria-label="Primary" className="ml-auto flex gap-[26px] max-[620px]:hidden">
          {NAV_LINKS.map((l) => (
            <a
              key={l.href}
              href={l.href}
              className="text-[15px] font-medium text-muted transition-colors hover:text-text"
            >
              {l.label}
            </a>
          ))}
        </nav>

        <LinkButton href="#install" variant="primary" sm className="ml-1 max-[620px]:ml-auto">
          Add to browser
        </LinkButton>
      </Wrap>
    </header>
  );
}
