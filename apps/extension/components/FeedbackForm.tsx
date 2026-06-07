import { useEffect, useRef, useState } from "react";
import { Button, Icon } from "@lineitem/ui";
import { FB_CONFIG, buildFeedbackForm, submitFeedback, type FeedbackKind } from "@/lib/feedback";

interface FeedbackFormProps {
  kind: FeedbackKind;
  /** Extra fields appended to the submission (e.g. { browser, version } for issues). */
  context?: Record<string, string>;
  /** Called by the success-state Close button. */
  onDone: () => void;
  /** When false, the row is collapsing — reset to a clean form after the animation. */
  active: boolean;
  /** Transport seam (defaults to the real Web3Forms POST). Overridden in stories/tests. */
  onSubmit?: (body: FormData) => Promise<{ ok: boolean }>;
}

type Status = "idle" | "sending" | "done" | "error";

export default function FeedbackForm({
  kind,
  context,
  onDone,
  active,
  onSubmit = submitFeedback,
}: FeedbackFormProps) {
  const cfg = FB_CONFIG[kind];
  const [primary, setPrimary] = useState("");
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<Status>("idle");

  // Track the latest `active` so an in-flight submit that resolves after the row
  // has collapsed doesn't write a stale success/error state onto a reset form.
  const activeRef = useRef(active);
  useEffect(() => {
    activeRef.current = active;
  }, [active]);

  // Reset to a clean form ~300ms after the row collapses (it stays mounted for
  // the max-height animation).
  useEffect(() => {
    if (active) return;
    const t = setTimeout(() => {
      setPrimary("");
      setEmail("");
      setStatus("idle");
    }, 300);
    return () => clearTimeout(t);
  }, [active]);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!primary.trim()) return;
    // Honeypot: bots fill hidden fields. Pretend success without sending.
    const honeypot = (e.currentTarget.elements.namedItem("botcheck") as HTMLInputElement)?.value;
    if (honeypot) {
      setStatus("done");
      return;
    }
    setStatus("sending");
    const body = buildFeedbackForm({ kind, primary, email, context });
    const { ok } = await onSubmit(body);
    // Bail if the row collapsed mid-flight — its state has already been reset.
    if (!activeRef.current) return;
    setStatus(ok ? "done" : "error");
  };

  if (status === "done") {
    return (
      <div className="flex flex-col items-center gap-2 px-[14px] py-[18px] text-center">
        <span className="flex h-9 w-9 items-center justify-center rounded-pill bg-ok-weak text-ok-text [&_svg]:h-[18px] [&_svg]:w-[18px]">
          <Icon.check aria-hidden width={18} height={18} />
        </span>
        <p className="m-0 text-[13px] leading-[1.5] text-muted">{cfg.success}</p>
        <Button variant="ghost" sm onClick={onDone}>
          Close
        </Button>
      </div>
    );
  }

  return (
    <form
      className="flex flex-col gap-[10px] px-[14px] pb-[14px] pt-[2px]"
      onSubmit={handleSubmit}
      // Validate in JS (primary required via the trim guard) so a malformed but
      // optional email never hard-blocks submit per the spec.
      noValidate
    >
      {context && kind === "issue" && (
        <div className="rounded-control bg-surface-2 px-[10px] py-[7px] text-[11.5px] text-faint">
          Includes your browser &amp; version automatically.
        </div>
      )}

      <label className="flex flex-col gap-[5px]">
        <span className="text-[12.5px] font-semibold text-text">{cfg.primaryLabel}</span>
        {cfg.multiline ? (
          <textarea
            className="rounded-control border border-line-strong bg-surface px-[11px] py-[9px] text-[13px] text-text outline-none focus:border-brand focus:ring-2 focus:ring-brand-weak"
            rows={3}
            value={primary}
            placeholder={cfg.placeholder}
            onChange={(e) => setPrimary(e.target.value)}
            required
          />
        ) : (
          <input
            className="rounded-control border border-line-strong bg-surface px-[11px] py-[9px] text-[13px] text-text outline-none focus:border-brand focus:ring-2 focus:ring-brand-weak"
            type="text"
            value={primary}
            placeholder={cfg.placeholder}
            onChange={(e) => setPrimary(e.target.value)}
            required
          />
        )}
      </label>

      <label className="flex flex-col gap-[5px]">
        <span className="text-[12.5px] font-semibold text-text">
          Email <span className="font-normal text-faint">{cfg.emailHint}</span>
        </span>
        <input
          className="rounded-control border border-line-strong bg-surface px-[11px] py-[9px] text-[13px] text-text outline-none focus:border-brand focus:ring-2 focus:ring-brand-weak"
          type="email"
          value={email}
          placeholder="you@example.com"
          onChange={(e) => setEmail(e.target.value)}
        />
      </label>

      {/* Honeypot — visually hidden, never focusable, must stay empty. */}
      <input
        type="text"
        name="botcheck"
        tabIndex={-1}
        autoComplete="off"
        aria-hidden="true"
        className="hidden"
      />

      <Button
        variant="primary"
        sm
        type="submit"
        busy={status === "sending"}
        busyLabel="Sending…"
        className="w-full"
      >
        {cfg.submit}
      </Button>

      {status === "error" && (
        <span className="text-[12px] text-danger">Couldn't send — try again.</span>
      )}
    </form>
  );
}
