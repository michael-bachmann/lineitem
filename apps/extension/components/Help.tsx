import { useId, useState } from "react";
import { FAQ, LINKS } from "@/lib/help-content";
import { BackLink, Row, SectionLabel, Icon } from "@lineitem/ui";
import CoffeeCard from "@/components/CoffeeCard";
import InvolveRow from "@/components/InvolveRow";
import { getBrowserInfo, type FeedbackKind } from "@/lib/feedback";

interface HelpProps {
  onBack: () => void;
  /** Extension version for the footer (passed from the manifest). */
  version?: string;
}

/** Help & About — coffee hero, FAQ accordion, get-involved/links rows, footer.
 *  No IO; the accordion is local UI state. */
export default function Help({ onBack, version = "0.0.0" }: HelpProps) {
  const [open, setOpen] = useState(0);
  const [involve, setInvolve] = useState<FeedbackKind | null>(null);
  const toggleInvolve = (k: FeedbackKind) => setInvolve((cur) => (cur === k ? null : k));
  const faqId = useId();

  return (
    <div className="flex min-h-screen flex-col gap-3 bg-bg p-4 text-text">
      <div className="flex flex-col items-start gap-[7px]">
        <BackLink onClick={onBack} label="Back" />
        <h1 className="m-0 text-[20px] font-bold tracking-[-0.018em] text-text">Help &amp; About</h1>
      </div>

      {/* Buy me a coffee — hero */}
      <CoffeeCard sub="It’s free and ad-free. A coffee keeps it maintained." />

      {/* FAQ */}
      <SectionLabel>Frequently asked</SectionLabel>
      <div className="overflow-hidden rounded-card border border-line bg-surface shadow-card">
        {FAQ.map((f, i) => {
          const isOpen = open === i;
          return (
            <div key={f.q} className={i > 0 ? "border-t border-line" : ""}>
              <button
                type="button"
                onClick={() => setOpen(isOpen ? -1 : i)}
                aria-expanded={isOpen}
                aria-controls={`${faqId}-${i}`}
                className="flex w-full items-center gap-[10px] px-[14px] py-[13px] text-left text-[13.5px] font-semibold text-text hover:bg-surface-2"
              >
                {f.q}
                <span
                  className={`ml-auto flex flex-none text-faint transition-transform ${isOpen ? "rotate-90" : ""}`}
                >
                  <Icon.chevR aria-hidden width={14} height={14} />
                </span>
              </button>
              <div
                id={`${faqId}-${i}`}
                aria-hidden={!isOpen}
                className={`overflow-hidden transition-[max-height] duration-[260ms] ${
                  isOpen ? "max-h-[220px]" : "max-h-0"
                }`}
              >
                <div className="px-[14px] pb-[13px] text-[13px] leading-[1.55] text-muted">
                  {f.a}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Get involved — inline feedback forms */}
      <SectionLabel>Get involved</SectionLabel>
      <div className="flex flex-col gap-[7px]">
        <InvolveRow
          icon={<Icon.store />}
          title="Request a retailer"
          sub="Tell us where to expand next"
          kind="retailer"
          expanded={involve === "retailer"}
          onToggle={() => toggleInvolve("retailer")}
        />
        <InvolveRow
          icon={<Icon.bulb />}
          title="Make a suggestion"
          sub="Ideas for the roadmap"
          kind="suggestion"
          expanded={involve === "suggestion"}
          onToggle={() => toggleInvolve("suggestion")}
        />
        <InvolveRow
          icon={<Icon.bug />}
          title="Report an issue"
          sub="Something broken? Let us know"
          kind="issue"
          expanded={involve === "issue"}
          onToggle={() => toggleInvolve("issue")}
          context={{ browser: getBrowserInfo(), version }}
        />
      </div>
      <p className="px-1 text-center text-[12px] leading-[1.5] text-faint">
        Prefer GitHub?{" "}
        <a
          href={LINKS.issue}
          target="_blank"
          rel="noopener noreferrer"
          className="text-muted underline hover:text-link"
        >
          Open an issue
        </a>
      </p>

      {/* Links */}
      <SectionLabel>Links</SectionLabel>
      <div className="flex flex-col gap-[7px]">
        <Row icon={<Icon.globe />} title="Website" sub="lineitem.app" href={LINKS.website} />
        <Row
          icon={<Icon.link />}
          title="README & docs"
          sub="github.com/michael-bachmann/lineitem"
          href={LINKS.readme}
        />
      </div>

      <div className="py-[6px] text-center text-[11.5px] leading-[1.7] text-faint">
        LineItem v{version} ·{" "}
        <a
          href={LINKS.website}
          target="_blank"
          rel="noopener noreferrer"
          className="text-muted no-underline hover:text-link"
        >
          lineitem.app
        </a>
        <br />
        Made for YNAB + Amazon
      </div>
    </div>
  );
}
