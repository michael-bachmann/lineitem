// Shared user-facing message strings — those used in more than one place.
// Single-use copy stays inline in its component/handler; this catalog exists to
// keep *repeated* messages consistent, and is the home to grow string
// management from. (See also matcher.ts's NO_MATCH_REASON / READ_FAILED_REASON,
// which are match-domain reasons kept next to the matcher.)

/** Shown when an action needs a connected YNAB plan but none is configured. */
export const NOT_CONNECTED = "Not connected to YNAB";

/** Shown when the OAuth refresh token is no longer valid — the only recovery
 *  is disconnecting and reconnecting. Shared so the UI can recognize it and
 *  keep it verbatim instead of substituting generic retry copy. */
export const YNAB_RECONNECT =
  "Your YNAB connection has expired. Disconnect and reconnect to continue.";
