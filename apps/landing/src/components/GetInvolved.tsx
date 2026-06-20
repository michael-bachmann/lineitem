import type { ReactNode } from "react";
import { Icon, type FeedbackKind } from "@lineitem/ui";
import { Wrap } from "./Wrap";
import { SectionHead } from "./SectionHead";
import InvolvedCard from "./InvolvedCard";
import { LINKS } from "@/lib/links";

const CARDS: { kind: FeedbackKind; icon: ReactNode; title: string; sub: string }[] = [
  {
    kind: "retailer",
    icon: <Icon.store width={21} height={21} />,
    title: "Request a retailer",
    sub: "Tell us where to expand next",
  },
  {
    kind: "suggestion",
    icon: <Icon.bulb width={21} height={21} />,
    title: "Make a suggestion",
    sub: "Ideas for the roadmap",
  },
  {
    kind: "issue",
    icon: <Icon.bug width={21} height={21} />,
    title: "Report an issue",
    sub: "Something broken? Let us know",
  },
];

export default function GetInvolved({ onFeedback }: { onFeedback: (kind: FeedbackKind) => void }) {
  return (
    <section id="involved" className="py-16 max-[620px]:py-12">
      <Wrap>
        <SectionHead
          eyebrow="Get involved"
          title="Help shape lineitem."
          sub="It's free and open — your input is what drives the roadmap."
        />
        <div className="mx-auto flex max-w-[620px] flex-col gap-[10px]">
          {CARDS.map((c) => (
            <InvolvedCard
              key={c.kind}
              icon={c.icon}
              title={c.title}
              sub={c.sub}
              onClick={() => onFeedback(c.kind)}
            />
          ))}
        </div>
        <p className="mt-[18px] text-center text-[14px] text-faint">
          Prefer GitHub?{" "}
          <a
            href={LINKS.issues}
            target="_blank"
            rel="noreferrer"
            className="font-semibold text-link hover:underline"
          >
            Open an issue there
          </a>{" "}
          · or email{" "}
          <a href={`mailto:${LINKS.email}`} className="font-semibold text-link hover:underline">
            {LINKS.email}
          </a>
        </p>
      </Wrap>
    </section>
  );
}
