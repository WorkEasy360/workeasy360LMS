// "Add video" flow: choose source (Upload is primary) → upload → process → preview → save.
import { h } from "../lib/dom.js";
import { icon as ico } from "../lib/icons.js";
import { bus } from "../lib/events.js";
import { Button } from "../components/Button.js";
import { Badge } from "../components/Badge.js";
import { Progress } from "../components/Progress.js";
import { Field, Input, Textarea, Select } from "../components/Form.js";
import { VideoPlayer } from "../components/VideoPlayer.js";
import { openModal } from "../components/Overlay.js";
import { settings } from "../services/people.js";
import { ACCEPTED_TYPES, ACCEPTED_EXT, videoStorage, validateFile, processVideo, fileToThumbnail, readCaptions, detectSource, newVideo, playbackUrl, fmtTime, fmtSize, SOURCE_LABEL } from "../services/videos.js";

/**
 * openVideoDialog({ user, course, video, onSave(video) })
 * `video` present → edit details of an existing video; otherwise start at "choose a source".
 */
export function openVideoDialog({ user, course, video = null, onSave }) {
  let stage = video ? "edit" : "choose";
  let source = null, file = null, abort = null, uploaded = null, processed = null, pct = 0, step = "uploaded", fileError = "";
  let working = video ? structuredClone(video) : null;
  let previewUrl = null, committed = false;

  const root = h("div", { class: "vd" });
  const cleanup = () => {
    abort?.abort();
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    if (uploaded && !committed) videoStorage.remove(uploaded.storageKey); // don't leave orphaned uploads behind
  };
  const modal = openModal({ title: video ? "Video details" : "Add video", size: "lg", content: root, onClose: cleanup });
  const close = () => modal.close();
  const draw = () => {
    root.replaceChildren(({ choose, upload, uploading, processing, ready, edit, url }[stage])());
    root.querySelector("[data-autofocus]")?.focus();
  };

  const back = () => Button({ label: "Back", icon: "arrow-left", variant: "ghost", size: "sm", cls: "align-self-start", onClick: () => { abort?.abort(); stage = "choose"; source = null; fileError = ""; draw(); } });

  // 1 — choose a source
  function choose() {
    const opt = (id, title, desc, icon, primary) => h("button", { class: ["vd-opt", primary && "is-primary"], type: "button", "data-guide-target": `video.source-${id}`, onclick: () => pick(id) }, [
      h("span", { class: "vd-opt-icon" }, ico(icon, primary ? 28 : 22)),
      h("span", { class: "grow", style: "text-align:left" }, [h("span", { class: "row-sm" }, [h("strong", {}, title), primary && Badge("Recommended", "primary")]), h("span", { class: "small muted", style: "display:block" }, desc)]),
      ico("chevron-right", 18),
    ]);
    return h("div", { class: "stack" }, [
      h("div", {}, [h("h3", {}, "How would you like to add your video?"), h("p", { class: "small muted" }, "Uploading keeps everything inside WorkEasy360 — no YouTube or Vimeo account needed.")]),
      opt("upload", "Upload Video", "Upload from your device", "upload", true),
      h("div", { class: "grid grid-3" }, [opt("youtube", "YouTube", "Add a YouTube URL", "video"), opt("vimeo", "Vimeo", "Add a Vimeo URL", "video"), opt("external", "Video URL", "Add a hosted video URL", "link")]),
    ]);
  }
  function pick(id) {
    source = id;
    bus.emit("video.source.selected", { source: id === "upload" ? "native" : id });
    stage = id === "upload" ? "upload" : "url";
    working = null;
    draw();
  }

  // 2 — pick a file (drag & drop or browse)
  function upload() {
    const input = h("input", { type: "file", accept: [...ACCEPTED_TYPES, ...ACCEPTED_EXT].join(","), hidden: true, "aria-label": "Choose a video file", onchange: (e) => e.target.files[0] && choose(e.target.files[0]) });
    const drop = h("div", { class: "dropzone", "data-vd": "dropzone", ondragover: (e) => { e.preventDefault(); drop.classList.add("is-over"); }, ondragleave: () => drop.classList.remove("is-over"), ondrop: (e) => { e.preventDefault(); drop.classList.remove("is-over"); e.dataTransfer.files[0] && choose(e.dataTransfer.files[0]); } }, [
      h("span", { class: "vd-opt-icon", style: "width:56px;height:56px" }, ico("upload", 28)),
      h("strong", { style: "font-size:18px" }, "Drag & drop your video here"), h("span", { class: "muted" }, "or"),
      Button({ label: "Browse Files", icon: "upload", variant: "primary", attrs: { "data-guide-target": "video.browse", "data-autofocus": "" }, onClick: () => input.click() }),
      h("span", { class: "small muted" }, `MP4, WebM, MOV · Maximum file size: ${settings().maxVideoMB || 200} MB`), input,
    ]);
    const choose = (f) => {
      const err = validateFile(f);
      if (err) { fileError = err; draw(); return; }
      fileError = ""; file = f;
      bus.emit("video.file.chosen", { name: f.name, size: f.size });
      startUpload();
    };
    return h("div", { class: "stack" }, [back(), h("h3", {}, "Upload Video"), drop, fileError && h("div", { class: "callout danger", role: "alert" }, [ico("alert", 18), fileError])]);
  }

  // 3 — upload with real progress
  async function startUpload() {
    stage = "uploading"; pct = 0; step = "uploaded"; abort = new AbortController(); draw();
    try {
      uploaded = await videoStorage.upload(file, { signal: abort.signal, courseId: course?.id, onProgress: (p) => { pct = p; paintUpload(); } });
      stage = "processing"; step = "processing"; draw();
      processed = await processVideo(file, { onStage: (s) => { step = s; paintProcessing(); } });
      step = "ready"; paintProcessing();
      await new Promise((r) => setTimeout(r, 350));
      previewUrl = URL.createObjectURL(file);
      working = newVideo({ sourceType: "native", storageKey: uploaded.storageKey, size: uploaded.size, mime: uploaded.mime, fileName: file.name, title: file.name.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " "), duration: processed.duration, width: processed.width, height: processed.height, thumbnail: processed.thumbnail, warning: processed.warning });
      bus.emit("video.ready", { name: file.name });
      stage = "ready"; draw();
    } catch (err) {
      if (err.name === "AbortError") return;
      fileError = "Something went wrong while uploading. Please try again."; stage = "upload"; draw();
    }
  }
  let pctEl, pctText;
  function uploading() {
    const bar = Progress(0, { label: "Upload progress" });
    pctEl = bar; pctText = h("span", { class: "small strong" }, "0% uploaded");
    return h("div", { class: "stack", "data-guide-target": "video.progress" }, [
      h("h3", {}, "Uploading…"),
      h("div", { class: "card card-pad stack-sm" }, [h("div", { class: "row-sm strong" }, [ico("video", 18), file.name, h("span", { class: "muted small" }, fmtSize(file.size))]), bar, pctText]),
      Button({ label: "Cancel", variant: "secondary", size: "sm", cls: "align-self-start", onClick: () => { abort?.abort(); stage = "upload"; draw(); } }),
    ]);
  }
  function paintUpload() { pctEl?.setValue(pct * 100); if (pctText) pctText.textContent = `${Math.round(pct * 100)}% uploaded`; }

  // 4 — processing checklist
  const STEPS = [["uploaded", "Uploaded"], ["processing", "Processing"], ["thumbnail", "Generating thumbnail"], ["ready", "Ready"]];
  const stepsEl = () => h("ul", { class: "stack-sm", "aria-live": "polite" }, STEPS.map(([id, label], i) => {
    const cur = STEPS.findIndex((s) => s[0] === step);
    const done = i < cur || step === "ready", active = i === cur && step !== "ready";
    return h("li", { class: "row-sm", style: done ? "color:var(--c-success)" : active ? "" : "color:var(--c-muted)" }, [done ? ico("check-circle", 20) : active ? h("span", { class: "spinner", style: "width:18px;height:18px;border-width:2.5px" }) : h("span", { class: "dot", style: "width:12px;height:12px;margin:4px;opacity:.35" }), h("span", { class: active ? "strong" : "" }, label)]);
  }));
  let stepsHost;
  function processing() { stepsHost = h("div", {}, stepsEl()); return h("div", { class: "stack", "data-guide-target": "video.progress" }, [h("h3", {}, "Processing video…"), h("p", { class: "small muted" }, file.name), h("div", { class: "card card-pad" }, stepsHost)]); }
  function paintProcessing() { stepsHost?.replaceChildren(stepsEl()); }

  // 5 — ready: preview + details + save
  function ready() { return detailsForm({ isNew: true }); }
  function edit() { return detailsForm({ isNew: false }); }
  function detailsForm({ isNew }) {
    const v = working;
    const isNative = v.sourceType === "native";
    const playerHost = h("div", { "data-guide-target": "video.preview" });
    if (isNative) {
      const srcPromise = isNew && previewUrl ? Promise.resolve(previewUrl) : playbackUrl(v, user, course);
      const p = VideoPlayer({ srcPromise, poster: v.thumbnail, title: v.title || "Video preview", captions: v.captions, duration: v.duration });
      p.player.video.addEventListener("play", () => bus.emit("video.previewed", {}), { once: true });
      playerHost.appendChild(p);
    } else if (v.sourceType === "external") {
      const p = VideoPlayer({ src: v.sourceUrl, title: v.title || "Video preview" });
      p.player.video.addEventListener("play", () => bus.emit("video.previewed", {}), { once: true });
      playerHost.appendChild(p);
    } else {
      const emb = detectSource(v.sourceUrl).embedUrl;
      playerHost.appendChild(h("iframe", { class: "video-frame", src: emb, title: v.title || "Video preview", allow: "encrypted-media; picture-in-picture", allowfullscreen: true }));
    }
    const thumb = h("img", { class: "vd-thumb", alt: "Video thumbnail", src: v.thumbnail || "", hidden: !v.thumbnail });
    const thumbInput = h("input", { type: "file", accept: "image/*", hidden: true, onchange: async (e) => { const f = e.target.files[0]; if (!f) return; try { v.thumbnail = await fileToThumbnail(f); thumb.src = v.thumbnail; thumb.hidden = false; } catch {} } });
    const capList = h("div", { class: "stack-sm" });
    const capInput = h("input", { type: "file", accept: ".vtt,.srt,text/vtt", hidden: true, onchange: async (e) => { const f = e.target.files[0]; if (!f) return; v.captions.push(await readCaptions(f)); paintCaps(); } });
    const paintCaps = () => capList.replaceChildren(...v.captions.map((c) => h("div", { class: "row-sm small" }, [ico("check-circle", 16), c.label, Button({ icon: "x", variant: "ghost", size: "sm", title: `Remove ${c.label}`, onClick: () => { v.captions = v.captions.filter((x) => x !== c); paintCaps(); } })])));
    paintCaps();
    const title = Input({ value: v.title, placeholder: "e.g. Sales onboarding introduction", oninput: (e) => (v.title = e.target.value) });
    const desc = Textarea({ rows: 3, value: v.description, placeholder: "What will learners get from this video?", oninput: (e) => (v.description = e.target.value) });
    const vis = Select({ options: [{ value: "course", label: "Course only" }, { value: "organisation", label: "Anyone in the organisation" }], value: v.visibility, onChange: (x) => (v.visibility = x) });
    const save = () => {
      if (!v.title.trim()) v.title = v.fileName || SOURCE_LABEL[v.sourceType] + " video";
      committed = true;
      delete v.warning;
      onSave(v);
      bus.emit("video.saved", { video: v });
      close();
    };
    return h("div", { class: "stack" }, [
      h("div", { class: "row-between" }, [h("h3", {}, isNew ? "Video ready ✓" : "Video details"), Badge(SOURCE_LABEL[v.sourceType], isNative ? "primary" : "")]),
      playerHost,
      v.warning && h("div", { class: "callout warning" }, [ico("alert", 18), v.warning]),
      h("div", { class: "grid grid-2" }, [Field({ label: "Title", control: title }), isNative ? Field({ label: "Duration", control: Input({ value: v.duration ? fmtTime(v.duration) : "Unknown", disabled: true }) }) : Field({ label: "Visibility", control: vis })]),
      Field({ label: "Description", control: desc }),
      isNative && h("div", { class: "grid grid-2" }, [
        Field({ label: "Thumbnail", control: h("div", { class: "row" }, [thumb, Button({ label: "Change thumbnail", size: "sm", onClick: () => thumbInput.click() }), thumbInput]) }),
        Field({ label: "Visibility", control: vis, hint: "Playback is checked against course access." }),
      ]),
      isNative && Field({ label: "Captions", hint: "WebVTT (.vtt) or SubRip (.srt)", control: h("div", { class: "stack-sm" }, [capList, Button({ label: "Upload Captions", icon: "upload", size: "sm", cls: "align-self-start", onClick: () => capInput.click() }), capInput]) }),
      isNative && h("p", { class: "xs muted" }, `${fmtSize(v.size)} · stored in this browser for the demo. Production stores videos in private object storage and streams them through a permission-checked CDN.`),
      h("div", { class: "row", style: "justify-content:flex-end" }, [Button({ label: "Cancel", onClick: close }), Button({ label: "Save video", variant: "primary", icon: "check", attrs: { "data-guide-target": "video.save" }, onClick: save })]),
    ]);
  }

  // URL sources (YouTube / Vimeo / external)
  function url() {
    const label = { youtube: "YouTube", vimeo: "Vimeo", external: "video" }[source];
    const input = Input({ placeholder: { youtube: "https://www.youtube.com/watch?v=…", vimeo: "https://vimeo.com/…", external: "https://example.com/video.mp4" }[source], "aria-label": `${label} URL`, "data-autofocus": "" });
    const err = h("div", { class: "hint", role: "alert", style: "color:var(--c-danger)", hidden: true });
    const go = () => {
      const d = detectSource(input.value);
      const bad = d.error || (source === "youtube" && d.sourceType !== "youtube" ? "That doesn't look like a YouTube link." : source === "vimeo" && d.sourceType !== "vimeo" ? "That doesn't look like a Vimeo link." : source === "external" && d.sourceType !== "external" ? "That's a YouTube or Vimeo link — pick that source instead." : "");
      if (bad) { err.textContent = bad; err.hidden = false; input.setAttribute("aria-invalid", "true"); return; }
      working = newVideo({ ...d, title: "" }); stage = "ready"; draw();
    };
    input.addEventListener("keydown", (e) => e.key === "Enter" && go());
    return h("div", { class: "stack" }, [back(), h("h3", {}, `Add ${label === "video" ? "a hosted video URL" : label + " URL"}`), Field({ label: "Link", control: input }), err, h("p", { class: "xs muted" }, source === "external" ? "Use a direct link to an .mp4 or .webm file you're allowed to stream." : "The video plays from " + label + ". Watch progress can't be tracked for embedded YouTube/Vimeo videos."), h("div", { class: "row", style: "justify-content:flex-end" }, Button({ label: "Continue", variant: "primary", iconRight: "arrow-right", onClick: go }))]);
  }

  draw();
  return modal;
}
