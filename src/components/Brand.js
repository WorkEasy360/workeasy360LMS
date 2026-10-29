// WorkEasy360 brand: the official WorkEasy360 logo (the same right-sized artwork WorkEasy360 Booking uses) followed by
// the product name, the "W" mark on its own, and the AI agent's artwork.
import { h } from "../lib/dom.js";

export const PRODUCT_NAME = "WorkEasy360 LMS";
const PRODUCT_SUFFIX = "LMS";
const ASSETS = "/src/assets/brand/";
export const AGENT_LOGO = ASSETS + "agent-logo.png";
export const BRAND_IMAGES = { logo: ASSETS + "workeasy360-logo.png", logoWhite: ASSETS + "workeasy360-logo-white.png", mark: ASSETS + "workeasy360-mark.png" };
/** Width ÷ height of the trimmed logo artwork (742 × 120). */
const LOGO_ASPECT = 742 / 120;
/** In the artwork the wordmark's baseline sits at 77.5% of the image height; `nudge` lines the product name up with it. */
const INLINE = { sm: { logo: 20, text: 13, nudge: 4, gap: 6 }, md: { logo: 26, text: 17, nudge: 5, gap: 8 }, lg: { logo: 34, text: 22, nudge: 7, gap: 10 } };
const STACKED = { sm: { logo: 22, text: 12 }, md: { logo: 26, text: 13 }, lg: { logo: 34, text: 16 } };
/** In the stacked layout the product name starts under the "W" of the wordmark (18.9% of the logo width). */
const WORDMARK_START = 0.189;

/** Logo + "LMS". `tone` is the background it sits on: "dark" uses the white wordmark. One accessible name: "WorkEasy360 LMS". */
export function ProductLogo({ tone = "light", layout = "inline", size = "md", decorative = false } = {}) {
  const stacked = layout === "stacked";
  const logoH = stacked ? STACKED[size].logo : INLINE[size].logo, logoW = Math.round(logoH * LOGO_ASPECT);
  const nameStyle = stacked
    ? `font-size:${STACKED[size].text}px;margin-top:${Math.round(logoH * 0.14)}px;margin-left:${Math.round(logoW * WORDMARK_START)}px`
    : `font-size:${INLINE[size].text}px;margin-top:${INLINE[size].nudge}px`;
  return h("span", { class: ["product-logo", `tone-${tone}`, stacked && "is-stacked"], "data-brand": "product-logo", ...(decorative ? { "aria-hidden": "true" } : { role: "img", "aria-label": PRODUCT_NAME }), style: stacked ? null : `column-gap:${INLINE[size].gap}px` }, [
    h("img", { src: tone === "dark" ? BRAND_IMAGES.logoWhite : BRAND_IMAGES.logo, alt: "", width: logoW, height: logoH, draggable: "false", style: `width:${logoW}px;height:${logoH}px` }),
    h("span", { class: "product-logo-name", "aria-hidden": "true", style: nameStyle }, PRODUCT_SUFFIX),
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
