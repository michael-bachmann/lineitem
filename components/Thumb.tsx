import { useState } from "react";
import { Icon } from "./icons";

// Consistent "product swatch": a fixed rounded frame so Amazon photos (with
// white baked into the pixels) blend into the chip via mix-blend instead of
// clashing. Photo and no-photo items share the same frame. The warm gradient
// fill + ring come from the design's --swatch-* tokens.
const FRAME =
  "relative h-[50px] w-[50px] flex-none overflow-hidden rounded-control border shadow-[inset_0_1px_0_rgba(255,255,255,.5),inset_0_0_0_1px_rgba(0,0,0,.03)]";
const SWATCH = { background: "var(--swatch-bg)", borderColor: "var(--swatch-ring)" } as const;

export function Thumb({ src, alt = "" }: { src?: string | null; alt?: string }) {
  const [failed, setFailed] = useState(false);

  if (src && !failed) {
    return (
      <div className={FRAME} style={SWATCH}>
        <img
          src={src}
          alt={alt}
          loading="lazy"
          onError={() => setFailed(true)}
          className="block h-full w-full object-contain p-[6px] mix-blend-multiply"
        />
      </div>
    );
  }

  return (
    <div
      className={`${FRAME} flex items-center justify-center text-faint`}
      style={SWATCH}
      title="No product image"
    >
      <Icon.box width={22} height={22} className="opacity-70" />
    </div>
  );
}
