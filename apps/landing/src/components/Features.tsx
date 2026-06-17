import type { ReactNode } from "react";
import { Icon } from "@lineitem/ui";
import { Wrap } from "./Wrap";
import FeatureItem from "./FeatureItem";

// The shared icon set has no crosshair, so the "in control" glyph is inlined.
const Crosshair = () => (
  <svg
    viewBox="0 0 24 24"
    width={19}
    height={19}
    fill="none"
    stroke="currentColor"
    strokeWidth={1.7}
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M12 3v18M3 12h18" />
    <circle cx="12" cy="12" r="9" />
  </svg>
);

const FEATURES: { icon: ReactNode; title: string; body: string }[] = [
  {
    icon: <Icon.wand width={19} height={19} />,
    title: "Learns your categories",
    body: "Backfill the last 12 months and LineItem suggests categories the way you'd assign them.",
  },
  {
    icon: <Icon.lock width={19} height={19} />,
    title: "Private by design",
    body: "Order details are matched locally in your browser. The only thing LineItem touches is YNAB.",
  },
  {
    icon: <Crosshair />,
    title: "You're always in control",
    body: "Review every match. Nothing is written to your budget until you say so.",
  },
];

export default function Features() {
  return (
    <section className="py-16 max-[620px]:py-12">
      <Wrap>
        <div className="grid grid-cols-1 gap-6 min-[861px]:grid-cols-3 min-[861px]:gap-[18px]">
          {FEATURES.map((f) => (
            <FeatureItem key={f.title} {...f} />
          ))}
        </div>
      </Wrap>
    </section>
  );
}
