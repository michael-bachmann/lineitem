import { useState } from "react";
import type { FeedbackKind } from "@lineitem/ui";
import { useScrolled } from "./lib/useScrolled";
import SiteNav from "./components/SiteNav";
import SiteFooter from "./components/SiteFooter";
import FeedbackModal from "./components/FeedbackModal";
import PrivacyPolicy from "./components/PrivacyPolicy";

/** The /privacy page: shared nav + footer wrapping the Privacy Policy prose.
 *  Owns the feedback modal so the footer's feedback links work here too. */
export default function PrivacyApp() {
  const scrolled = useScrolled();
  const [feedback, setFeedback] = useState<FeedbackKind | null>(null);

  return (
    <>
      <SiteNav scrolled={scrolled} />
      <PrivacyPolicy />
      <SiteFooter onFeedback={setFeedback} />
      <FeedbackModal kind={feedback} onClose={() => setFeedback(null)} />
    </>
  );
}
