// WorkEasy360 brand: the official WorkEasy360 logo (the same right-sized artwork WorkEasy360 Booking uses) followed by
// the product name, the "W" mark on its own, and the AI agent's artwork.
import { h } from "../lib/dom.js";

export const PRODUCT_NAME = "WorkEasyLMS";
const PRODUCT_SUFFIX = "LMS";
const ASSETS = "/src/assets/brand/";
export const AGENT_LOGO = ASSETS + "agent-logo.png?v=2"; // ?v busts caches of the old opaque artwork
export const BRAND_IMAGES = { logo: ASSETS + "workeasy360-logo.png", logoWhite: ASSETS + "workeasy360-logo-white.png", mark: ASSETS + "workeasy360-mark.png" };

/** The product lockup: the official "W" mark followed by the wordmark written as WorkEasy + LMS, with LMS in brand
 *  green exactly where the company artwork writes its green 360. `tone` is the background it sits on. One
 *  accessible name: "WorkEasyLMS". `layout` is accepted for call-site compatibility; the lockup is one line. */
export function ProductLogo({ tone = "light", layout = "inline", size = "md", decorative = false } = {}) {
  const mark = { sm: 20, md: 28, lg: 40 }[size] || 28;
  return h("span", { class: ["product-logo", `tone-${tone}`], "data-brand": "product-logo", ...(decorative ? { "aria-hidden": "true" } : { role: "img", "aria-label": PRODUCT_NAME }), style: `--logo-mark:${mark}px` }, [
    h("img", { src: BRAND_IMAGES.mark, alt: "", width: mark, height: mark, draggable: "false" }),
    h("span", { class: "product-logo-word", "aria-hidden": "true" }, ["WorkEasy", h("b", {}, PRODUCT_SUFFIX)]),
  ]);
}

/** The "W" mark on its own (compact navigation). Leave `label` empty when nearby text already names the product. */
export function ProductMark(size = 32, label = "", cls = "") {
  return h("img", { class: ["product-mark", cls], src: BRAND_IMAGES.mark, alt: label, width: size, height: size, draggable: "false", "data-brand": "product-mark" });
}

/** The AI agent's artwork, decorative (the surrounding control or heading names the agent). */
export function AgentAvatar(size = 28, cls = "") {
  return h("img", { class: ["agent-avatar", cls], src: AGENT_LOGO, alt: "", width: size, height: size, draggable: "false", style: `width:${size}px;height:${size}px` });
}
