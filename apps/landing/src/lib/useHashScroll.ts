import { useEffect } from "react";

/**
 * Scrolls to the URL's fragment target once, after mount.
 *
 * Arriving on a page via an in-page link from elsewhere (e.g. /privacy → /#how),
 * the browser runs its native fragment scroll before React has rendered the
 * target section, so it lands at the top instead. This re-applies the scroll
 * once the section exists — and once webfonts have settled the layout, so a late
 * reflow doesn't leave it a few pixels off.
 *
 * Same-page anchor clicks are unaffected: their target is already in the DOM, so
 * they scroll natively; this hook only runs on mount.
 */
export function useHashScrollOnLoad() {
  useEffect(() => {
    const id = window.location.hash.slice(1);
    if (!id) return;

    // Wait for fonts so a swap-induced reflow doesn't land the scroll short.
    // `cancelled` drops the scroll if the page unmounts before fonts resolve.
    let cancelled = false;
    document.fonts.ready.then(() => {
      if (!cancelled) {
        document.getElementById(id)?.scrollIntoView({ behavior: "instant" });
      }
    });

    return () => {
      cancelled = true;
    };
  }, []);
}
