import type { ReactNode } from "react";

/** Numbered how-it-works card: step number, icon, title, body. */
export default function StepCard({
  n,
  icon,
  title,
  body,
}: {
  n: number;
  icon: ReactNode;
  title: string;
  body: string;
}) {
  return (
    <li className="relative flex flex-col gap-[10px] rounded-card border border-line bg-surface px-[22px] py-[26px] shadow-card">
      <span className="absolute right-5 top-[18px] text-[13px] font-bold text-faint tabular">{n}</span>
      <span
        aria-hidden
        className="mb-1 flex h-11 w-11 items-center justify-center rounded-[12px] bg-brand-weak text-brand"
      >
        {icon}
      </span>
      <h3 className="text-[19px] font-bold tracking-[-0.02em] text-text">{title}</h3>
      <p className="text-[15px] leading-[1.55] text-muted">{body}</p>
    </li>
  );
}
