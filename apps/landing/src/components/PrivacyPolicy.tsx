import { LINKS } from "@/lib/links";
import {
  LegalPage,
  LegalTldr,
  LegalSection,
  LegalList,
  LegalTable,
  LegalCallout,
} from "./LegalPage";

/** The lineitem Privacy Policy — content ported from the design reference, kept
 *  accurate to how the product actually works. Composed from the generic
 *  LegalPage primitives so a future Terms page can reuse the same layout. */
export default function PrivacyPolicy() {
  return (
    <LegalPage title="Privacy Policy" updated="June 20, 2026">
      <LegalTldr title="The short version">
        lineitem reads your Amazon and Target order details <b>locally in your browser</b> to
        match them to YNAB transactions. The only data that ever leaves your device goes to{" "}
        <b>YNAB</b> (to read your budget and write the splits you approve) and, if you contact us,
        to our <b>feedback form</b>. No analytics, no trackers, no ads, and we never sell your data.
      </LegalTldr>

      <LegalSection title="Who this covers">
        <p>
          This policy applies to the lineitem browser extension (Chrome and Firefox) and this
          website, <a href={LINKS.website}>lineitem.dev</a>. lineitem is an independent project and
          is not affiliated, associated, or in any way officially connected with YNAB, Amazon, or
          Target.
        </p>
      </LegalSection>

      <LegalSection title="What lineitem does with your data">
        <p>
          lineitem's job is to match the charges in your YNAB budget to the online orders behind
          them, then split each charge into budget categories. To do that, it works with two kinds
          of information — and handles them very differently.
        </p>

        <h3>Order details — processed locally, never sent to us</h3>
        <p>
          When you sync, lineitem reads your recent order details from your logged-in Amazon and
          Target sessions (item names, prices, quantities, order dates and amounts). This matching
          happens <b>entirely inside your browser</b>. Your order history is never transmitted to a
          lineitem server — we don't operate a server that receives it, and we couldn't read it if
          we wanted to.
        </p>

        <h3>YNAB data — read and written only with your approval</h3>
        <p>
          With your authorization, lineitem connects to YNAB to read your budgets and categories and
          to write the transaction splits you approve. We request read-and-write access because the
          app writes splits; nothing is written back to your budget until you press Approve. You can
          disconnect lineitem from YNAB at any time, from the extension's Settings or from your YNAB
          account's connected-apps page.
        </p>
        <p>
          Connecting to YNAB uses OAuth. The one-time authorization code and the tokens that keep
          you signed in pass through lineitem's authorization service (auth.lineitem.dev) — a thin
          relay that completes the secure exchange with YNAB and stores nothing. Your access token is then kept only on your device; your budget
          and order data never pass through that service.
        </p>
      </LegalSection>

      <LegalSection title="Where your data goes">
        <p>These are the only external connections lineitem makes:</p>
        <LegalTable
          head={["Service", "What's shared", "When"]}
          rows={[
            [
              "YNAB",
              "Your budgets and categories (read); the category splits you approve (write).",
              "When you sync and when you approve a split.",
            ],
            [
              "Amazon / Target",
              <>
                lineitem reads order pages from your own logged-in session. Nothing is sent <i>to</i>{" "}
                them beyond normal page requests.
              </>,
              "When you sync or backfill.",
            ],
            [
              "lineitem auth service",
              "The OAuth authorization code and token-refresh requests, relayed to YNAB to sign you in. No budget or order data passes through it, and nothing is stored.",
              "When you connect YNAB and when your sign-in is silently refreshed.",
            ],
            [
              "Web3Forms",
              "Only the message and (optional) email you type into a feedback form.",
              "Only when you submit “Request a retailer,” “Make a suggestion,” or “Report an issue.”",
            ],
          ]}
        />
        <LegalCallout>
          There are no analytics SDKs, advertising networks, fingerprinting, or third-party trackers
          anywhere in lineitem.
        </LegalCallout>
      </LegalSection>

      <LegalSection title="What we store">
        <LegalList>
          <li>
            <b>On your device:</b> your settings, your YNAB authorization token, and the category
            patterns lineitem learns from your history (used to suggest categories). This lives in
            your browser's local extension storage, not on our servers, and is kept until you
            disconnect or uninstall.
          </li>
          <li>
            <b>On our side:</b> nothing about your orders or budget. The only personal data we ever
            receive is what you choose to send through a feedback form — and we use it solely to
            reply to you.
          </li>
        </LegalList>
      </LegalSection>

      <LegalSection title="Feedback you send us">
        <p>
          If you submit a feedback form, your message is delivered to us by email through{" "}
          <a href="https://web3forms.com" target="_blank" rel="noreferrer">
            Web3Forms
          </a>
          , a form-relay service. If you include your email address, we use it only to respond. We
          don't add you to any mailing list, and we delete correspondence we no longer need.
        </p>
      </LegalSection>

      <LegalSection title="Your choices">
        <LegalList>
          <li>
            <b>Disconnect anytime:</b> revoke lineitem's YNAB access from Settings or from YNAB
            directly.
          </li>
          <li>
            <b>Uninstall:</b> removing the extension deletes its local storage, including your token
            and learned patterns.
          </li>
          <li>
            <b>Delete on request:</b> because we keep nothing about your budget or orders, there's
            nothing on our side to erase. For any feedback message you've emailed us, write to{" "}
            <a href={`mailto:${LINKS.email}`}>{LINKS.email}</a> and we'll delete it.
          </li>
          <li>
            <b>Skip the forms:</b> every feedback form is optional, and the email field within it is
            optional too.
          </li>
        </LegalList>
      </LegalSection>

      <LegalSection title="Children">
        <p>
          lineitem is a budgeting tool intended for adults and is not directed to children under 13.
        </p>
      </LegalSection>

      <LegalSection title="Changes to this policy">
        <p>
          If we change how lineitem handles data, we'll update this page and the “last updated” date
          above, and prompt you to review any material change before it takes effect. Material
          changes will also be noted in the extension's release notes.
        </p>
      </LegalSection>

      <LegalSection title="Contact">
        <p>
          Questions about privacy? Email{" "}
          <a href={`mailto:${LINKS.email}`}>{LINKS.email}</a> or open an issue on{" "}
          <a href={LINKS.issues} target="_blank" rel="noreferrer">
            GitHub
          </a>
          .
        </p>
      </LegalSection>
    </LegalPage>
  );
}
