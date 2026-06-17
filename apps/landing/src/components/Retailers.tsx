import type { FeedbackKind } from "@lineitem/ui";
import { Wrap } from "./Wrap";
import { SectionHead } from "./SectionHead";
import RetailerRow from "./RetailerRow";

export default function Retailers({ onFeedback }: { onFeedback: (kind: FeedbackKind) => void }) {
  return (
    <section id="retailers" className="py-16 max-[620px]:py-12">
      <Wrap>
        <SectionHead
          eyebrow="Supported retailers"
          title="Works with Amazon and Target."
          sub="More retailers are on the way. Tell us where you shop and we'll prioritize it."
        />
        <div className="mx-auto flex max-w-[520px] flex-col gap-[10px]">
          <RetailerRow variant="live" name="Amazon" />
          <RetailerRow variant="live" name="Target" />
          <RetailerRow variant="planned" name="Walmart" />
          <RetailerRow
            variant="request"
            name="Request a retailer"
            onClick={() => onFeedback("retailer")}
          />
        </div>
      </Wrap>
    </section>
  );
}
