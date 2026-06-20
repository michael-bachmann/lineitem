import { Wrap } from "./Wrap";
import StoreButton from "./StoreButton";
import PanelMock from "./PanelMock";
import { LINKS } from "@/lib/links";

/** Hero: headline + value lede + install CTAs + trust line, with the PanelMock. */
export default function Hero() {
  return (
    <Wrap className="grid grid-cols-1 items-center gap-11 pb-14 pt-12 min-[861px]:grid-cols-[1.05fr_0.95fr] min-[861px]:gap-14 min-[861px]:pb-20 min-[861px]:pt-[72px]">
      <div className="flex flex-col items-center gap-5 text-center min-[861px]:items-start min-[861px]:text-left">
        <span className="text-[12.5px] font-bold uppercase tracking-[0.14em] text-brand">
          For YNAB shoppers
        </span>
        <h1 className="text-[clamp(34px,5.2vw,56px)] font-extrabold leading-[1.05] tracking-[-0.03em] text-text">
          One order, split into the right budget categories.
        </h1>
        <p className="max-w-[30em] text-[clamp(16px,1.6vw,19px)] leading-[1.55] text-muted">
          lineitem reads the actual items behind your Amazon and Target charges in YNAB,
          then splits each charge into the right categories — so a single{" "}
          <span className="font-semibold text-text tabular">$42.98</span> charge becomes groceries,
          household, and the rest. Nothing posts to YNAB until you approve.
        </p>

        <div
          id="install"
          className="flex flex-wrap gap-3 max-[620px]:w-full max-[400px]:flex-col"
        >
          <StoreButton store="chrome" href={LINKS.chrome} />
          <StoreButton store="firefox" href={LINKS.firefox} />
        </div>

        <p className="flex items-center gap-2 text-[13.5px] text-faint">
          <span className="h-2 w-2 flex-none rounded-full bg-ok shadow-[0_0_0_3px_var(--ok-weak)]" />
          Free &amp; open source · Your order data never leaves your browser
        </p>
      </div>

      <div className="flex justify-center">
        <PanelMock variant="detail" />
      </div>
    </Wrap>
  );
}
