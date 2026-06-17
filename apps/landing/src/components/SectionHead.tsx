/** Centered eyebrow + heading (+ optional sub) atop a section. */
export function SectionHead({
  eyebrow,
  title,
  sub,
}: {
  eyebrow: string;
  title: string;
  sub?: string;
}) {
  return (
    <div className="mx-auto mb-9 flex max-w-[640px] flex-col gap-3 text-center">
      <span className="text-[12.5px] font-bold uppercase tracking-[0.14em] text-brand">{eyebrow}</span>
      <h2 className="text-[clamp(26px,3.4vw,36px)] font-bold leading-[1.1] tracking-[-0.02em] text-text">
        {title}
      </h2>
      {sub && <p className="text-[16px] leading-[1.55] text-muted">{sub}</p>}
    </div>
  );
}
