// Spotlight: dims the app column (not the guide panel) and cuts a live-tracking hole around the active target.
// Targets are located via  data-guide-target="course.add-module"  so guides work across screens and re-renders.
import { h } from "../lib/dom.js";
import { guideEngine } from "./GuideEngine.js";

export function findGuideTarget(names) {
  for (const name of [].concat(names || [])) {
    for (const el of document.querySelectorAll(`[data-guide-target="${name}"]`)) {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) return el;
    }
  }
  return null;
}

export function initSpotlight() {
  const host = document.getElementById("guide-spotlight");
  const badge = h("span", { class: "guide-hole-badge" });
  const hole = h("div", { class: "guide-hole", hidden: true }, badge);
  host.appendChild(hole);

  let lastEl = null, lastKey = "", moveTimer = null, scrollTries = 0;

  const hide = () => { if (!hole.hidden) hole.hidden = true; lastEl = null; };

  function frame() {
    const { open, finished, misroute, stepDone, stepIndex } = guideEngine.state;
    const step = guideEngine.step;
    const el = open && !finished && !misroute && step ? findGuideTarget(step.target) : null;
    if (!el) {
      hide();
    } else {
      const hostRect = host.getBoundingClientRect();
      const r = el.getBoundingClientRect();
      const pad = 6;
      const box = { top: r.top - hostRect.top - pad, left: r.left - hostRect.left - pad, w: r.width + pad * 2, h: r.height + pad * 2 };
      const inView = r.top >= hostRect.top + 60 && r.bottom <= hostRect.bottom - 8 && r.left >= hostRect.left && r.right <= hostRect.right;
      if (el !== lastEl) {
        scrollTries = 0;
        hole.classList.add("is-moving");
        clearTimeout(moveTimer);
        moveTimer = setTimeout(() => hole.classList.remove("is-moving"), 450);
        lastEl = el;
      }
      if (!inView && scrollTries < 3) {
        scrollTries++;
        el.scrollIntoView({ block: "center", inline: "nearest", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
      }
      const key = `${box.top}|${box.left}|${box.w}|${box.h}|${stepDone}|${stepIndex}`;
      if (key !== lastKey) {
        lastKey = key;
        Object.assign(hole.style, { top: box.top + "px", left: box.left + "px", width: box.w + "px", height: box.h + "px" });
        hole.classList.toggle("is-done", !!stepDone);
        badge.textContent = stepDone ? "✓" : String(stepIndex + 1);
      }
      hole.hidden = false;
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}
