import { useEffect, useState } from "react";
import SiteNav from "./components/SiteNav";
import Hero from "./components/Hero";
import HowItWorks from "./components/HowItWorks";
import Features from "./components/Features";
import SiteFooter from "./components/SiteFooter";

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
  return (
    <>
      <SiteNav scrolled={scrolled} />
      <main id="top">
        <Hero />
        <HowItWorks />
        <Features />
      </main>
      <SiteFooter />
    </>
  );
}
