import { useEffect, useState } from "react";
import type { FeedbackKind } from "@lineitem/ui";
import { useScrolled } from "./lib/useScrolled";
import SiteNav from "./components/SiteNav";
import Hero from "./components/Hero";
import HowItWorks from "./components/HowItWorks";
import Features from "./components/Features";
import Retailers from "./components/Retailers";
import Faq from "./components/Faq";
import GetInvolved from "./components/GetInvolved";
import CoffeeBand from "./components/CoffeeBand";
import FinalCta from "./components/FinalCta";
import SiteFooter from "./components/SiteFooter";
import FeedbackModal from "./components/FeedbackModal";

export default function App() {
  const scrolled = useScrolled();
  // The page owns the feedback modal; sections open it via `setFeedback(kind)`.
  const [feedback, setFeedback] = useState<FeedbackKind | null>(null);

  // Re-apply a landing hash after mount. Arriving from another page (e.g.
  // /privacy → /#how) the browser tries to scroll to the fragment before React
  // has rendered the section, so the native jump finds nothing. Once the
  // sections exist — and webfonts have settled the layout — scroll to it.
  useEffect(() => {
    const id = window.location.hash.slice(1);
    if (!id) return;
    let cancelled = false;
    const scroll = () => {
      if (!cancelled) {
        document.getElementById(id)?.scrollIntoView({ behavior: "instant" as ScrollBehavior });
      }
    };
    if (document.fonts) document.fonts.ready.then(scroll);
    else requestAnimationFrame(scroll);
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <>
      <SiteNav scrolled={scrolled} />
      <main id="top">
        <Hero />
        <HowItWorks />
        <Features />
        <Retailers onFeedback={setFeedback} />
        <Faq />
        <GetInvolved onFeedback={setFeedback} />
        <CoffeeBand />
        <FinalCta />
      </main>
      <SiteFooter onFeedback={setFeedback} />
      <FeedbackModal kind={feedback} onClose={() => setFeedback(null)} />
    </>
  );
}
