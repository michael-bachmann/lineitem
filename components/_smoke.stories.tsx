import type { Meta, StoryObj } from "@storybook/react-vite";

// Literal class strings — Tailwind only generates utilities it can see as
// complete tokens in source, so no `bg-${role}` interpolation here.
const swatches: { label: string; cls: string }[] = [
  { label: "bg", cls: "bg-bg" },
  { label: "surface", cls: "bg-surface" },
  { label: "surface-2", cls: "bg-surface-2" },
  { label: "surface-3", cls: "bg-surface-3" },
  { label: "ink", cls: "bg-ink" },
  { label: "brand", cls: "bg-brand" },
  { label: "ok", cls: "bg-ok" },
  { label: "attention", cls: "bg-attention" },
  { label: "danger", cls: "bg-danger" },
];

function ThemeSwatches() {
  return (
    <div className="font-sans text-text" style={{ width: 384 }}>
      <p className="text-lg font-bold tracking-[-0.018em]">
        Hanken Grotesk · token check
      </p>
      <p className="text-muted">
        Secondary text · <span className="tabular">$42.99</span>
      </p>
      <div className="mt-3 grid grid-cols-3 gap-2">
        {swatches.map((s) => (
          <div key={s.label} className="space-y-1">
            <div
              className={`h-12 rounded-card border border-line shadow-card ${s.cls}`}
            />
            <p className="text-faint text-xs">{s.label}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

const meta: Meta<typeof ThemeSwatches> = {
  title: "Foundation/Theme",
  component: ThemeSwatches,
};
export default meta;

export const Swatches: StoryObj<typeof ThemeSwatches> = {};
