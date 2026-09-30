import { h } from "../lib/dom.js";
import { icon as ico } from "../lib/icons.js";

// Button({ label, icon, iconRight, variant: primary|secondary|soft|ghost|danger|success, size: sm|lg, href, onClick, loading, disabled, attrs })
export function Button({ label, icon, iconRight, variant = "secondary", size, onClick, href, loading, disabled, attrs = {}, title, cls = "" }) {
  const iconOnly = !label && icon;
  const el = h(href ? "a" : "button", {
    class: ["btn", `btn-${variant}`, size && `btn-${size}`, iconOnly && "btn-icon", loading && "is-loading", cls],
    ...(href ? { href: "#" + href } : { type: "button" }),
    ...(disabled && !href ? { disabled: true } : {}),
    ...(title ? { title, "aria-label": iconOnly ? title : undefined } : {}),
    onclick: onClick,
    ...attrs,
  }, [icon && ico(icon, size === "sm" ? 16 : 18), label, iconRight && ico(iconRight, size === "sm" ? 16 : 18)]);
  if (loading) el.setAttribute("aria-busy", "true");
  return el;
}

export const IconButton = (opts) => Button({ variant: "ghost", size: "sm", ...opts });
