import type { ReactNode } from "react";
import { Icon } from "@lineitem/ui";
import { Wrap } from "./Wrap";
import { SectionHead } from "./SectionHead";
import StepCard from "./StepCard";
import PanelMock from "./PanelMock";

const STEPS: { icon: ReactNode; title: string; body: string }[] = [
  {
    icon: <Icon.sync width={22} height={22} />,
    title: "Sync",
    body: "lineitem finds your recent retailer charges in YNAB and matches each one to the order behind it.",
  },
  {
    icon: <Icon.wand width={22} height={22} />,
    title: "Review",
    body: "Every line item gets a category — suggested from your own history. Adjust anything, or apply one category to the lot.",
  },
  {
    icon: <Icon.check width={22} height={22} />,
    title: "Approve",
    body: "One tap writes the split back to YNAB. Nothing changes in your budget until you approve it.",
  },
];

export default function HowItWorks() {
  return (
    <section id="how" className="py-16 max-[620px]:py-12">
      <Wrap>
        <SectionHead
          eyebrow="How it works"
          title="From a mystery charge to a clean budget in three steps."
        />
        {/* Queue mock beside the steps: the detail hero showed the "magic"; this
            shows where it fits the routine. Mock drops below the steps ≤860px. */}
        <div className="grid grid-cols-1 items-center gap-8 min-[861px]:grid-cols-[320px_1fr] min-[861px]:gap-11">
          <div className="order-2 flex justify-center min-[861px]:order-none">
            <PanelMock variant="queue" />
          </div>
          <ol className="order-1 grid gap-[14px] min-[861px]:order-none">
            {STEPS.map((step, i) => (
              <StepCard key={step.title} n={i + 1} {...step} />
            ))}
          </ol>
        </div>
      </Wrap>
    </section>
  );
}
