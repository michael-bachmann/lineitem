import { useEffect, useState } from "react";
import type { FeedbackKind } from "@lineitem/ui";
import SiteNav from "./components/SiteNav";
import Hero from "./components/Hero";
import HowItWorks from "./components/HowItWorks";
import Features from "./components/Features";
import Retailers from "./components/Retailers";
import Faq from "./components/Faq";
import SiteFooter from "./components/SiteFooter";
import FeedbackModal from "./components/FeedbackModal";

/** True once the page is scrolled past the top — drives the nav's hairline. */
function useScrolled() {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 4);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  return scrolled;
}

export default function App() {
  const scrolled = useScrolled();
  // The page owns the feedback modal; sections open it via `setFeedback(kind)`.
  const [feedback, setFeedback] = useState<FeedbackKind | null>(null);

  return (
    <>
      <SiteNav scrolled={scrolled} />
      <main id="top">
        <Hero />
        <HowItWorks />
        <Features />
        <Retailers onFeedback={setFeedback} />
        <Faq />
      </main>
      <SiteFooter />
      <FeedbackModal kind={feedback} onClose={() => setFeedback(null)} />
    </>
  );
}
