import { Icon, LinkButton } from "@lineitem/ui";

type Store = "chrome" | "firefox";

const STORE = {
  chrome: { variant: "primary", label: "Add to Chrome", sub: "Chrome Web Store" },
  firefox: { variant: "secondary", label: "Add to Firefox", sub: "Firefox Add-ons" },
} as const satisfies Record<Store, { variant: "primary" | "secondary"; label: string; sub: string }>;

/** Install CTA: store glyph + two-line label, as a variant of the shared LinkButton. */
export default function StoreButton({
  store,
  href,
  className = "",
}: {
  store: Store;
  href: string;
  className?: string;
}) {
  const s = STORE[store];
  return (
    <LinkButton
      href={href}
      variant={s.variant}
      // LinkButton is w-full by default; sit side-by-side above the 400px stack point.
      className={`gap-3 py-[13px] min-[401px]:w-auto ${className}`}
    >
      <Icon.ext aria-hidden width={22} height={22} className="flex-none" />
      <span className="flex flex-col items-start leading-[1.15]">
        <span className="text-[15px] font-bold">{s.label}</span>
        <span className="text-[11.5px] font-medium opacity-80">{s.sub}</span>
      </span>
    </LinkButton>
  );
}
