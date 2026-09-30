import { Button } from "./Button.js";
import { guideEngine } from "../guide/GuideEngine.js";

// "Guide me" — opens the persistent guide panel for the given guide.
export function GuideButton(guideId, { label = "Guide me", variant = "soft", size } = {}) {
  return Button({
    label, icon: "help", variant, size, attrs: { "data-guide-launch": guideId },
    onClick: () => guideEngine.open(guideId, { source: "guide-button" }),
  });
}
