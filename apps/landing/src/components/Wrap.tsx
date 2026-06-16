import type { ReactNode } from "react";

/** Centered, max-width page container (the reference's `.wrap`: 1080px, 24px pad). */
export function Wrap({ className = "", children }: { className?: string; children: ReactNode }) {
  return <div className={`mx-auto w-full max-w-[1080px] px-6 ${className}`}>{children}</div>;
}
