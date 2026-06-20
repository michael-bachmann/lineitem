import { useEffect, useId, useRef, useState } from "react";
import { FeedbackForm, Icon, type FeedbackKind } from "@lineitem/ui";
import { PRIVACY_PATH } from "@/lib/links";

type Glyph = (typeof Icon)[keyof typeof Icon];

// Modal header copy per kind. (The form body + success copy come from the
// shared FB_CONFIG; this is just the dialog's heading.)
const HEAD: Record<FeedbackKind, { title: string; desc: string; Glyph: Glyph }> = {
  retailer: {
    title: "Request a retailer",
    desc: "Tell us where you shop and we'll prioritize it.",
    Glyph: Icon.store,
  },
  suggestion: {
    title: "Make a suggestion",
    desc: "Got an idea to make lineitem better? We're listening.",
    Glyph: Icon.bulb,
  },
  issue: {
    title: "Report an issue",
    desc: "Something not working? Tell us what happened.",
    Glyph: Icon.bug,
  },
};

interface FeedbackModalProps {
  /** Which feedback form to show, or `null` when closed. */
  kind: FeedbackKind | null;
  onClose: () => void;
  /** Transport seam forwarded to FeedbackForm (defaults to the real Web3Forms POST). */
  onSubmit?: (body: FormData) => Promise<{ ok: boolean }>;
}

/** Accessible modal wrapping the shared FeedbackForm. Uses a native <dialog> for
 *  focus-trapping + top-layer; closes on Esc / backdrop / ×; locks body scroll. */
export default function FeedbackModal({ kind, onClose, onSubmit }: FeedbackModalProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const open = kind !== null;

  // Keep showing the last kind while the dialog closes, so content doesn't blank.
  const [shown, setShown] = useState<FeedbackKind>("retailer");
  useEffect(() => {
    if (kind) setShown(kind);
  }, [kind]);

  useEffect(() => {
    const dlg = ref.current;
    if (!dlg || !open) return;
    // Remember the trigger so focus returns to it on close (WCAG 2.4.3).
    const trigger = document.activeElement as HTMLElement | null;
    if (!dlg.open) dlg.showModal();
    // Land focus on the first real field, not the × or the hidden honeypot.
    dlg.querySelector<HTMLElement>("input:not([tabindex='-1']), textarea")?.focus();
    // Deliberately NOT locking body scroll: showModal() already makes the page
    // behind inert, and toggling `overflow: hidden` removes the scrollbar, which
    // reflows the layout + re-centers the dialog on classic scrollbars (BAC-137).
    return () => {
      if (dlg.open) dlg.close();
      trigger?.focus?.();
    };
  }, [open]);

  const head = HEAD[shown];

  return (
    <dialog
      ref={ref}
      aria-modal="true"
      aria-labelledby={titleId}
      onClose={onClose}
      // Backdrop click: the dialog element is the only thing behind the card.
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
      // m-auto restores native dialog centering (Tailwind preflight resets the UA margin).
      // overflow-clip: the native <dialog> defaults to overflow:auto, so the 8px
      // entrance translate briefly makes it scrollable and flashes its scrollbar
      // (BAC-137). `clip` is never a scroll container; the clip-margin keeps the
      // card's shadow-pop visible.
      className="m-auto w-[min(440px,calc(100vw-32px))] overflow-clip [overflow-clip-margin:40px] bg-transparent p-0 backdrop:bg-[rgba(47,42,51,0.44)]"
    >
      {/* px-[10px] + the form's own px-[14px] = 24px field inset; the header
          carries a matching px-[14px] so it lines up. */}
      <div className="relative flex max-h-[calc(100vh-32px)] flex-col gap-3 overflow-y-auto rounded-card border border-line bg-surface px-[10px] pb-[10px] pt-[18px] shadow-pop motion-safe:animate-[fbPop_0.19s_cubic-bezier(0.4,0,0.2,1)]">
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute right-[13px] top-[13px] flex h-[30px] w-[30px] items-center justify-center rounded-control text-faint transition-colors hover:bg-surface-3 hover:text-muted"
        >
          <Icon.x aria-hidden width={17} height={17} />
        </button>

        <div className="flex items-start gap-[13px] px-[14px] pr-[34px]">
          <span className="flex h-10 w-10 flex-none items-center justify-center rounded-[11px] bg-brand-weak text-brand">
            <head.Glyph aria-hidden width={20} height={20} />
          </span>
          <div>
            <h2 id={titleId} className="text-[18px] font-bold tracking-[-0.018em] text-text">
              {head.title}
            </h2>
            <p className="mt-[3px] text-[14px] text-muted">{head.desc}</p>
          </div>
        </div>

        <FeedbackForm kind={shown} active={open} onDone={onClose} onSubmit={onSubmit} />

        <p className="px-[14px] pb-[6px] text-center text-[11.5px] leading-[1.5] text-faint">
          Only what you type is sent.{" "}
          <a href={PRIVACY_PATH} className="text-muted underline hover:text-link">
            Privacy
          </a>
        </p>
      </div>
    </dialog>
  );
}
