import { Wrap } from "./Wrap";
import { SectionHead } from "./SectionHead";
import { FaqAccordion } from "./FaqAccordion";
import { FAQ } from "@/lib/faq";

export default function Faq() {
  return (
    <section id="faq" className="py-16 max-[620px]:py-12">
      <Wrap>
        <SectionHead eyebrow="FAQ" title="Good questions." />
        <FaqAccordion items={FAQ} />
      </Wrap>
    </section>
  );
}
