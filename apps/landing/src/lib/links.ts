// Outbound links are the shared canonical set from @lineitem/ui.
export { LINKS } from "@lineitem/ui/links";

export const VERSION = "v1.4.0";

/** Same-origin route for the Privacy Policy page (the extension links to the
 *  absolute LINKS.privacy; in-site links use this relative path so they resolve
 *  in dev/preview too). */
export const PRIVACY_PATH = "/privacy";
