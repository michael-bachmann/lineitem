import MarkSvg from "./mark.svg?react";

/** Brand mark — rounded-square badge with three "line item" bars. The artwork
 *  lives in mark.svg (the single source of truth, also rasterized into the
 *  extension icons by @wxt-dev/auto-icons); here it's rendered as a component. */
export function Mark({ size = 24, className = "" }: { size?: number; className?: string }) {
  return (
    <MarkSvg
      width={size}
      height={size}
      aria-hidden="true"
      className={`block flex-none ${className}`}
    />
  );
}

/** Brand mark + lowercase "lineitem" wordmark. */
export function BrandRow({ size = 22, className = "" }: { size?: number; className?: string }) {
  return (
    <div className={`flex items-center gap-[10px] ${className}`}>
      <Mark size={size} />
      <span className="text-[20px] font-bold lowercase tracking-[-0.018em] text-text">
        lineitem
      </span>
    </div>
  );
}
