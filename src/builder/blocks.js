// Content block registry: each block type has a learner `view` and an author `edit`.
// Block registry: every type here is fully editable, renderable and syncable; add a type by extending BLOCK_TYPES.
import { h, uid, md } from "../lib/dom.js";
import { icon as ico } from "../lib/icons.js";
import { Button } from "../components/Button.js";
import { Field, Input, Textarea, Select } from "../components/Form.js";
import { QuestionView, Feedback } from "../quiz/QuizRunner.js";
import { QuestionEditor } from "./QuestionEditor.js";
import { newQuestion, isAnswered } from "../quiz/engine.js";
import { bus } from "../lib/events.js";
import { Badge } from "../components/Badge.js";
import { Progress } from "../components/Progress.js";
import { VideoPlayer } from "../components/VideoPlayer.js";
import { openVideoDialog } from "./VideoDialog.js";
import { videoOf, detectSource, playbackUrl, getVideoProgress, videoStorage, fmtTime, fmtSize, SOURCE_LABEL } from "../services/videos.js";

const embedUrl = (url) => {
  const yt = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]{11})/);
  if (yt) return `https://www.youtube-nocookie.com/embed/${yt[1]}`;
  const vm = url.match(/vimeo\.com\/(\d+)/);
  return vm ? `https://player.vimeo.com/video/${vm[1]}` : null;
};
const safeUrl = (u) => (/^https?:\/\//i.test(u) ? u : "");

export const BLOCK_TYPES = {
  heading: {
    label: "Heading", icon: "heading", create: () => ({ text: "" }),
    view: (b) => h("h2", { class: "block-heading" }, b.text || "Heading"),
    edit: (b, { commit }) => Input({ value: b.text, placeholder: "Section heading", "aria-label": "Heading", oninput: (e) => { b.text = e.target.value; commit(); } }),
  },
  text: {
    label: "Text", icon: "file", create: () => ({ text: "" }),
    view: (b) => h("div", { class: "prose", html: md(b.text) || '<p class="muted">Empty text block</p>' }),
    edit: (b, { commit }) => Field({ control: Textarea({ rows: 5, value: b.text, placeholder: "Write your content. Supports **bold**, *italic*, - lists and [links](https://…)", "aria-label": "Text content", oninput: (e) => { b.text = e.target.value; commit(); } }), hint: "Blank line = new paragraph. Start lines with “- ” for bullets." }),
  },
  image: {
    label: "Image", icon: "image", create: () => ({ url: "", alt: "", caption: "" }),
    view: (b) => h("figure", { class: "block-figure" }, [
      safeUrl(b.url) ? h("img", { src: b.url, alt: b.alt || "", loading: "lazy" }) : h("div", { class: "media-ph" }, [ico("image", 32), h("span", {}, "Image placeholder")]),
      b.caption && h("figcaption", { class: "small muted" }, b.caption),
    ]),
    edit: (b, { commit }) => h("div", { class: "stack-sm" }, [
      Field({ label: "Image URL", control: Input({ value: b.url, placeholder: "https://…/image.jpg", oninput: (e) => { b.url = e.target.value; commit(); } }) }),
      Field({ label: "Alt text (for screen readers)", control: Input({ value: b.alt, oninput: (e) => { b.alt = e.target.value; commit(); } }) }),
      Field({ label: "Caption", control: Input({ value: b.caption, oninput: (e) => { b.caption = e.target.value; commit(); } }) }),
    ]),
  },
  video: {
    label: "Video", icon: "video", create: () => ({ video: null, caption: "" }),
    view: (b, ctx = {}) => videoView(b, ctx),
    edit: (b, { commit, redraw, ctx = {} }) => videoEdit(b, { commit, redraw, ctx }),
  },
  quote: {
    label: "Quote", icon: "quote", create: () => ({ text: "", by: "" }),
    view: (b) => h("blockquote", { class: "block-quote" }, [h("p", {}, b.text || "Quote"), b.by && h("cite", {}, `— ${b.by}`)]),
    edit: (b, { commit }) => h("div", { class: "stack-sm" }, [
      Field({ label: "Quote", control: Textarea({ rows: 2, value: b.text, oninput: (e) => { b.text = e.target.value; commit(); } }) }),
      Field({ label: "Attribution", control: Input({ value: b.by || "", oninput: (e) => { b.by = e.target.value; commit(); } }) }),
    ]),
  },
  callout: {
    label: "Callout", icon: "info", create: () => ({ tone: "info", text: "" }),
    view: (b) => h("div", { class: ["callout", b.tone === "info" ? "" : b.tone] }, [ico({ info: "info", tip: "bulb", warning: "alert", danger: "alert" }[b.tone] || "info", 18), h("div", { html: md(b.text) })]),
    edit: (b, { commit }) => h("div", { class: "stack-sm" }, [
      Select({ options: [{ value: "info", label: "Info" }, { value: "tip", label: "Tip" }, { value: "warning", label: "Warning" }], value: b.tone, onChange: (v) => { b.tone = v; commit(); }, attrs: { "aria-label": "Callout style" } }),
      Textarea({ rows: 2, value: b.text, placeholder: "Highlight something important", "aria-label": "Callout text", oninput: (e) => { b.text = e.target.value; commit(); } }),
    ]),
  },
  checklist: {
    label: "Checklist", icon: "list", create: () => ({ items: [{ id: uid("i"), text: "" }] }),
    view: (b) => h("ul", { class: "block-checklist stack-sm" }, b.items.map((it) => h("li", {}, h("label", { class: "check" }, [h("input", { type: "checkbox" }), h("span", {}, it.text || "…")])))),
    edit: (b, { commit, redraw }) => h("div", { class: "stack-sm" }, [
      ...b.items.map((it, i) => h("div", { class: "row-sm" }, [Input({ value: it.text, placeholder: `Item ${i + 1}`, "aria-label": `Checklist item ${i + 1}`, oninput: (e) => { it.text = e.target.value; commit(); } }), Button({ icon: "x", variant: "ghost", size: "sm", title: "Remove", disabled: b.items.length <= 1, onClick: () => { b.items.splice(i, 1); commit(); redraw(); } })])),
      Button({ label: "Add item", icon: "plus", variant: "ghost", size: "sm", cls: "align-self-start", onClick: () => { b.items.push({ id: uid("i"), text: "" }); commit(); redraw(); } }),
    ]),
  },
  accordion: {
    label: "Accordion", icon: "layers", create: () => ({ items: [{ id: uid("i"), title: "", body: "" }] }),
    view: (b) => h("div", { class: "stack-sm" }, b.items.map((it) => h("details", { class: "acc" }, [h("summary", {}, [h("span", { class: "grow" }, it.title || "Untitled"), ico("chevron-down", 18)]), h("div", { class: "prose", html: md(it.body) })]))),
    edit: (b, { commit, redraw }) => h("div", { class: "stack-sm" }, [
      ...b.items.map((it, i) => h("div", { class: "card card-pad-sm stack-sm" }, [
        h("div", { class: "row-sm" }, [Input({ value: it.title, placeholder: "Section title", "aria-label": `Section ${i + 1} title`, oninput: (e) => { it.title = e.target.value; commit(); } }), Button({ icon: "x", variant: "ghost", size: "sm", title: "Remove section", disabled: b.items.length <= 1, onClick: () => { b.items.splice(i, 1); commit(); redraw(); } })]),
        Textarea({ rows: 2, value: it.body, placeholder: "Section content", "aria-label": `Section ${i + 1} content`, oninput: (e) => { it.body = e.target.value; commit(); } }),
      ])),
      Button({ label: "Add section", icon: "plus", variant: "ghost", size: "sm", cls: "align-self-start", onClick: () => { b.items.push({ id: uid("i"), title: "", body: "" }); commit(); redraw(); } }),
    ]),
  },
  link: {
    label: "Link / button", icon: "link", create: () => ({ label: "Open resource", url: "" }),
    view: (b) => h("a", { class: "btn btn-secondary", href: safeUrl(b.url) || undefined, target: "_blank", rel: "noopener noreferrer", "aria-disabled": safeUrl(b.url) ? undefined : "true" }, [ico("link", 18), b.label || "Link", ico("arrow-right", 16)]),
    edit: (b, { commit }) => h("div", { class: "grid grid-2" }, [
      Field({ label: "Button label", control: Input({ value: b.label, oninput: (e) => { b.label = e.target.value; commit(); } }) }),
      Field({ label: "URL", control: Input({ value: b.url, placeholder: "https://…", oninput: (e) => { b.url = e.target.value; commit(); } }) }),
    ]),
  },
  knowledge: {
    label: "Knowledge check", icon: "clipboard", create: () => ({ question: newQuestion("mc") }),
    view: (b) => KnowledgeCheck(b.question),
    edit: (b, { commit, redraw }) => QuestionEditor(b.question, { commit, redraw, index: 0, onDelete: () => { b.question = newQuestion("mc"); commit(); redraw(); } }),
  },
};


function KnowledgeCheck(q) {
  const box = h("div", { class: "card card-pad-sm stack knowledge" });
  let value, checked = false;
  const draw = () => {
    box.replaceChildren(
      h("div", { class: "row-sm eyebrow" }, [ico("clipboard", 14), "Knowledge check"]),
      QuestionView(q, { value, reveal: checked, onChange: (v) => { value = v; if (q.type !== "short") draw(); else btn.disabled = !isAnswered(q, v); } }),
      checked && Feedback(q, value), btn
    );
    btn.disabled = checked || !isAnswered(q, value);
  };
  const btn = Button({ label: "Check answer", variant: "primary", size: "sm", cls: "align-self-start", onClick: () => { checked = true; draw(); } });
  draw();
  return box;
}

export function newBlock(type) {
  return { id: uid("b"), type, ...BLOCK_TYPES[type].create() };
}

export const renderBlocks = (blocks, ctx = {}) => h("div", { class: "blocks stack" }, blocks.map((b) => (BLOCK_TYPES[b.type] ? BLOCK_TYPES[b.type].view(b, ctx) : null)));

// ---------- video block ----------
// No play button here: this is a "nothing to play yet" notice, and a big play circle begs to be clicked.
const placeholder = (text) => h("div", { class: "media-ph video-ph" }, [ico("video", 28), h("span", {}, text)]);

function videoView(b, ctx) {
  const v = videoOf(b);
  if (!v) return h("figure", { class: "block-figure" }, placeholder(ctx.author ? "No video yet — add one in the Course Builder" : "Video coming soon"));
  let media;
  if (v.sourceType === "youtube" || v.sourceType === "vimeo") {
    media = h("iframe", { class: "video-frame", src: detectSource(v.sourceUrl).embedUrl, title: v.title || "Video", allow: "encrypted-media; picture-in-picture", allowfullscreen: true, loading: "lazy" });
  } else {
    const prog = ctx.tracking && ctx.user ? getVideoProgress(ctx.user.id, ctx.course.id, b.id) : null;
    const resumeAt = prog && !prog.completed && prog.percent < 95 ? prog.lastPosition || prog.position : 0;
    const label = h("span", { class: "small strong" });
    const bar = Progress(prog?.maxPercent || 0, { size: "sm", label: "Video progress" });
    const paint = (p) => { bar.setValue(p?.maxPercent || 0); label.textContent = p?.completed ? "Watched ✓" : p?.maxPercent ? `Video progress ${Math.round(p.maxPercent)}%${p.lastPosition > 5 ? ` · Resume from ${fmtTime(p.lastPosition)}` : ""}` : "Not started"; };
    paint(prog);
    const player = VideoPlayer({
      srcPromise: v.sourceType === "native" ? playbackUrl(v, ctx.user, ctx.course) : Promise.resolve(v.sourceUrl),
      poster: v.thumbnail, title: v.title || "Video", captions: v.captions || [], resumeAt, duration: v.duration,
      onEvent: ctx.tracking && ctx.user ? (evt) => { const p = ctx.onVideoEvent?.(b, evt); paint(p || null); } : undefined,
    });
    media = h("div", { class: "stack-sm", "data-video-block": b.id }, [player, ctx.tracking && h("div", { class: "row-sm vp-progress" }, [h("div", { style: "flex:1" }, bar), label])]);
  }
  return h("figure", { class: "block-figure" }, [media, (v.description || b.caption) && h("figcaption", { class: "small muted" }, v.description || b.caption)]);
}

// Opens the source chooser / upload flow for a block and stores the result on it.
export function chooseVideo(b, ctx, done, existing = null) {
  bus.emit("video.dialog.opened", {});
  return openVideoDialog({
    user: ctx.user, course: ctx.course, video: existing,
    onSave: (video) => {
      const old = b.video;
      b.video = video; delete b.url;
      if (old?.sourceType === "native" && old.storageKey !== video.storageKey) videoStorage.remove(old.storageKey);
      ctx.flush?.();
      done?.();
      bus.emit("lesson.saved", { blockId: b.id });
    },
  });
}

function videoEdit(b, { commit, redraw, ctx }) {
  if (b.video === undefined) { b.video = videoOf(b); delete b.url; }
  const v = b.video;
  if (!v) {
    return h("div", { class: "video-empty" }, [
      h("span", { class: "vd-opt-icon" }, ico("video", 24)),
      h("div", { class: "grow" }, [h("strong", {}, "No video yet"), h("div", { class: "small muted" }, "Upload a video, or add a YouTube, Vimeo or hosted URL.")]),
      Button({ label: "Add video", icon: "upload", variant: "primary", attrs: { "data-guide-target": "video.add" }, onClick: () => chooseVideo(b, ctx, redraw) }),
    ]);
  }
  return h("div", { class: "stack-sm" }, [
    h("div", { class: "video-summary" }, [
      v.thumbnail ? h("img", { class: "vd-thumb", src: v.thumbnail, alt: "" }) : h("span", { class: "vd-opt-icon", style: "width:96px;height:60px" }, ico("video", 24)),
      h("div", { class: "grow", style: "min-width:0" }, [
        h("div", { class: "strong truncate" }, v.title || "Untitled video"),
        h("div", { class: "row-sm wrap small muted" }, [Badge(SOURCE_LABEL[v.sourceType], v.sourceType === "native" ? "primary" : ""), v.duration ? fmtTime(v.duration) : null, v.size ? fmtSize(v.size) : null, v.captions?.length ? `${v.captions.length} caption track${v.captions.length > 1 ? "s" : ""}` : null]),
      ]),
      h("div", { class: "row-sm wrap" }, [
        Button({ label: "Preview & details", icon: "eye", size: "sm", onClick: () => chooseVideo(b, ctx, redraw, v) }),
        Button({ label: "Replace", icon: "refresh", size: "sm", onClick: () => chooseVideo(b, ctx, redraw) }),
        Button({ icon: "trash", variant: "ghost", size: "sm", title: "Remove video", onClick: () => { if (v.sourceType === "native") videoStorage.remove(v.storageKey); b.video = null; commit(); redraw(); } }),
      ]),
    ]),
  ]);
}
