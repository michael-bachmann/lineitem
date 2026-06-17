import { Wrap } from "./Wrap";
import StoreButton from "./StoreButton";
import { LINKS } from "@/lib/links";

export default function FinalCta() {
  return (
    <section className="pb-[88px] pt-7">
      <Wrap className="flex flex-col items-center gap-6 text-center">
        <h2 className="max-w-[16em] text-[clamp(26px,3.6vw,38px)] font-bold leading-[1.1] tracking-[-0.02em] text-text">
          Stop guessing what that order charge was.
        </h2>
        <div className="flex flex-wrap justify-center gap-3 max-[400px]:w-full max-[400px]:flex-col">
          <StoreButton store="chrome" href={LINKS.chrome} />
          <StoreButton store="firefox" href={LINKS.firefox} />
        </div>
      </Wrap>
    </section>
  );
}
