import type { Meta, StoryObj } from "@storybook/react-vite";
import {
  LegalPage,
  LegalTldr,
  LegalSection,
  LegalList,
  LegalTable,
  LegalCallout,
} from "./LegalPage";
import PrivacyPolicy from "./PrivacyPolicy";

const meta = {
  title: "Landing/LegalPage",
  component: LegalPage,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof LegalPage>;

export default meta;
type Story = StoryObj<typeof LegalPage>;

/** The real Privacy Policy, end to end. */
export const PrivacyPage: Story = {
  render: () => <PrivacyPolicy />,
};

/** Bare layout: a single prose section with no structured blocks. */
export const EmptySection: Story = {
  render: () => (
    <LegalPage title="Terms of Service" updated="June 20, 2026">
      <LegalSection title="Overview">
        <p>
          This is an empty section — just a heading and a paragraph of prose, demonstrating the base
          layout a future legal page starts from.
        </p>
      </LegalSection>
    </LegalPage>
  ),
};

/** The "where your data goes" grid in isolation. */
export const Table: Story = {
  render: () => (
    <LegalPage title="Legal table" updated="June 20, 2026">
      <LegalSection title="Where your data goes">
        <LegalTable
          head={["Service", "What's shared", "When"]}
          rows={[
            ["YNAB", "Budgets and categories (read); approved splits (write).", "On sync and approve."],
            ["Web3Forms", "Only what you type into a feedback form.", "Only on submit."],
          ]}
        />
      </LegalSection>
    </LegalPage>
  ),
};

/** The TL;DR, sage callout, and bulleted list primitives. */
export const Callout: Story = {
  render: () => (
    <LegalPage title="Callouts" updated="June 20, 2026">
      <LegalTldr title="The short version">
        Everything happens <b>locally in your browser</b>. No trackers, no ads, no data selling.
      </LegalTldr>
      <LegalSection title="Reassurance">
        <LegalCallout>
          There are no analytics SDKs, advertising networks, fingerprinting, or third-party trackers
          anywhere in lineitem.
        </LegalCallout>
        <LegalList>
          <li>
            <b>Disconnect anytime:</b> revoke access from Settings or from YNAB directly.
          </li>
          <li>
            <b>Uninstall:</b> removing the extension deletes its local storage.
          </li>
        </LegalList>
      </LegalSection>
    </LegalPage>
  ),
};
