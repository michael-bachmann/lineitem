import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import FeedbackModal from "./FeedbackModal";

const meta = {
  title: "Landing/FeedbackModal",
  component: FeedbackModal,
  parameters: { layout: "fullscreen" },
  args: {
    onClose: fn(),
    // Stub the transport so stories never hit Web3Forms.
    onSubmit: fn(async () => ({ ok: true })),
  },
} satisfies Meta<typeof FeedbackModal>;

export default meta;
type Story = StoryObj<typeof FeedbackModal>;

export const Retailer: Story = { args: { kind: "retailer" } };
export const Suggestion: Story = { args: { kind: "suggestion" } };
export const Issue: Story = { args: { kind: "issue" } };

/** Fill the form and submit to reach the success state. */
export const Success: Story = {
  args: { kind: "retailer" },
  play: async () => {
    // The dialog renders in the top layer, outside Storybook's canvas — query the doc.
    const dialog = within(document.body);
    await userEvent.type(dialog.getByRole("textbox", { name: /which retailer/i }), "Costco");
    await userEvent.click(dialog.getByRole("button", { name: /send request/i }));
    await expect(await dialog.findByText(/request received/i)).toBeInTheDocument();
  },
};
