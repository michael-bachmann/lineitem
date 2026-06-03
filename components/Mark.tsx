/** Brand mark — rounded-square badge with three "line item" bars (doubles as
 *  the extension icon). Pure SVG; the fill uses the `--brand` token. */
export function Mark({ size = 24 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 28 28"
      fill="none"
      aria-hidden="true"
      className="block flex-none"
    >
      <rect width="28" height="28" rx="8.5" fill="var(--brand)" />
      <rect x="7" y="8.2" width="11" height="2.7" rx="1.35" fill="#fff" />
      <rect x="7" y="12.65" width="14" height="2.7" rx="1.35" fill="#fff" opacity="0.92" />
      <rect x="7" y="17.1" width="8" height="2.7" rx="1.35" fill="#fff" opacity="0.66" />
    </svg>
  );
}

/** Brand mark + lowercase "lineitem" wordmark. */
export function BrandRow({ size = 22 }: { size?: number }) {
  return (
    <div className="flex items-center gap-[10px]">
      <Mark size={size} />
      <span className="text-[20px] font-bold lowercase tracking-[-0.018em] text-text">
        lineitem
      </span>
    </div>
  );
}
