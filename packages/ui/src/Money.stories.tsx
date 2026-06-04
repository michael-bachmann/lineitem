import type { Meta, StoryObj } from "@storybook/react-vite";
import { Money } from "./Money";

function MoneyColumn() {
  const values = [42.99, 8.5, 1299.0, 5.99, 113.07];
  return (
    <div className="flex flex-col gap-1 text-text" style={{ width: 140 }}>
      {values.map((v) => (
        <div key={v} className="flex justify-between border-b border-line pb-1">
          <span className="text-muted">Item</span>
          <Money value={v} />
        </div>
      ))}
    </div>
  );
}

const meta = { title: "Primitives/Money", component: MoneyColumn } satisfies Meta<typeof MoneyColumn>;
export default meta;

export const TabularAlignment: StoryObj<typeof MoneyColumn> = {};
