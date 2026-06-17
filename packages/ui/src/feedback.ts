// packages/ui/src/feedback.ts
// Non-visual core for the feedback forms (Web3Forms, no backend). Shared by the
// extension's Help "Get involved" rows and the landing page's FeedbackModal.

export type FeedbackKind = "retailer" | "suggestion" | "issue";

export interface FeedbackConfig {
  primaryLabel: string;
  /** Field name sent to Web3Forms for the primary input. */
  primaryName: string;
  multiline: boolean;
  placeholder: string;
  emailHint: string;
  submit: string;
  success: string;
}

export const FB_CONFIG: Record<FeedbackKind, FeedbackConfig> = {
  retailer: {
    primaryLabel: "Which retailer?",
    primaryName: "retailer",
    multiline: false,
    placeholder: "e.g. Costco, Best Buy, IKEA",
    emailHint: "optional — we'll tell you when it's ready",
    submit: "Send request",
    success: "Request received! We prioritize the most-requested retailers.",
  },
  suggestion: {
    primaryLabel: "Your idea",
    primaryName: "suggestion",
    multiline: true,
    placeholder: "What would make LineItem more useful?",
    emailHint: "optional — only if you'd like a reply",
    submit: "Send suggestion",
    success: "Thanks for the idea! Every suggestion gets read.",
  },
  issue: {
    primaryLabel: "What went wrong?",
    primaryName: "description",
    multiline: true,
    placeholder: "What you expected vs. what happened.",
    emailHint: "optional — add it if we should follow up",
    submit: "Send report",
    success: "Thanks for the report! We'll dig in.",
  },
};

export const FB_ENDPOINT = "https://api.web3forms.com/submit";

// Web3Forms access keys are publishable — they only route mail to the owner's
// address. Override at build time via VITE_WEB3FORMS_KEY; the literal fallback
// keeps every build working without a local .env.
export const FB_ACCESS_KEY: string =
  import.meta.env.VITE_WEB3FORMS_KEY ?? "a6bf3788-b829-40d1-9f92-5b0cfbbae83c";

export interface BuildFeedbackArgs {
  kind: FeedbackKind;
  primary: string;
  email: string;
  context?: Record<string, string>;
  /** Honeypot value. Sent to Web3Forms so its server-side spam check engages —
   *  a non-empty value (only a bot fills the hidden field) is dropped server-side. */
  botcheck?: string;
}

/** Build the Web3Forms FormData payload. Pure — no IO. */
export function buildFeedbackForm({
  kind,
  primary,
  email,
  context,
  botcheck = "",
}: BuildFeedbackArgs): FormData {
  const cfg = FB_CONFIG[kind];
  const body = new FormData();
  body.append("access_key", FB_ACCESS_KEY);
  body.append("subject", `LineItem · ${kind}`);
  body.append("request_type", kind);
  body.append(cfg.primaryName, primary);
  if (email) body.append("email", email);
  if (context) {
    for (const [k, v] of Object.entries(context)) body.append(k, v);
  }
  // Always present so Web3Forms' honeypot runs; empty for real submissions.
  body.append("botcheck", botcheck);
  return body;
}

/** Basic email-shape check. Used to validate the optional email *only when
 *  provided* — an empty string is not "valid" (callers gate on non-empty). */
export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/** Parse a userAgent into a short "Browser NN" string for the issue report. */
export function getBrowserInfo(ua: string = navigator.userAgent): string {
  const edge = /Edg\/(\d+)/.exec(ua);
  if (edge) return `Edge ${edge[1]}`;
  const firefox = /Firefox\/(\d+)/.exec(ua);
  if (firefox) return `Firefox ${firefox[1]}`;
  const chrome = /Chrome\/(\d+)/.exec(ua);
  if (chrome) return `Chrome ${chrome[1]}`;
  return "Unknown browser";
}

/** POST the payload to Web3Forms. Returns { ok } — never throws. */
export async function submitFeedback(body: FormData): Promise<{ ok: boolean }> {
  try {
    const res = await fetch(FB_ENDPOINT, {
      method: "POST",
      headers: { Accept: "application/json" },
      body,
    });
    const json = (await res.json()) as { success?: boolean };
    return { ok: json.success === true };
  } catch {
    return { ok: false };
  }
}
