import type { ReactNode } from "react";

/** Feature trio: icon tile + title + body. */
export default function FeatureItem({
  icon,
  title,
  body,
}: {
  icon: ReactNode;
  title: string;
  body: string;
}) {
  return (
    <div className="flex flex-col gap-[9px] p-1">
      <span className="flex h-[38px] w-[38px] items-center justify-center rounded-[10px] border border-line bg-surface text-muted shadow-card">
        {icon}
      </span>
      <h4 className="text-[16.5px] font-bold tracking-[-0.02em] text-text">{title}</h4>
      <p className="text-[14.5px] leading-[1.55] text-muted">{body}</p>
    </div>
  );
}
