// Native WorkEasy360 video player: custom controls, keyboard support, captions, speed, PiP, fullscreen,
// resume-from-position and progress events. Architecture leaves room for chapters, transcripts, in-video questions,
// timestamped discussions and watch-completion rules (see services/videos.js).
import { h } from "../lib/dom.js";
import { icon as ico } from "../lib/icons.js";
import { fmtTime } from "../services/videos.js";

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];

/**
 * VideoPlayer({ src | srcPromise, poster, title, captions:[{id,label,vtt}], resumeAt, onEvent })
 * onEvent({type:"started"|"progress"|"paused"|"resumed"|"completed", position, duration, percent, maxPercent})
 */
export function VideoPlayer({ src, srcPromise, poster, title = "Video", captions = [], resumeAt = 0, duration: knownDuration = 0, onEvent }) {
  const D = () => (isFinite(video.duration) && video.duration > 0 ? video.duration : knownDuration || 0);
  const video = h("video", { class: "vp-video", preload: "metadata", playsinline: "", poster: poster || undefined, "aria-label": title });
  const root = h("div", { class: "vp is-paused", tabindex: "0", role: "group", "aria-label": `Video player: ${title}. Press space to play or pause.` });
  const status = h("div", { class: "vp-status", role: "status" }, [h("span", { class: "spinner" }), h("span", {}, "Loading video…")]);
  const bigPlay = h("button", { class: "vp-big", type: "button", "aria-label": "Play video", onclick: () => toggle() }, ico("play", 34));
  const cur = h("span", { class: "vp-time" }, "00:00"), dur = h("span", { class: "vp-time" }, "00:00");
  const seek = h("input", { class: "vp-seek", type: "range", min: "0", max: "1000", value: "0", step: "1", "aria-label": "Seek", oninput: () => { if (D()) video.currentTime = (seek.value / 1000) * D(); paint(); } });
  const vol = h("input", { class: "vp-vol", type: "range", min: "0", max: "1", step: "0.05", value: "1", "aria-label": "Volume", oninput: () => { video.volume = +vol.value; video.muted = video.volume === 0; syncVol(); } });
  const playBtn = ctl("play", "Play", () => toggle());
  const muteBtn = ctl("volume", "Mute", () => { video.muted = !video.muted; syncVol(); });
  const speedBtn = h("button", { class: "vp-btn vp-speed", type: "button", "aria-label": "Playback speed 1×", title: "Playback speed", onclick: () => setSpeed(SPEEDS[(SPEEDS.indexOf(video.playbackRate) + 1) % SPEEDS.length]) }, "1×");
  const ccBtn = captions.length ? ctl("cc", "Captions off", () => toggleCaptions()) : null;
  const pipBtn = document.pictureInPictureEnabled ? ctl("pip", "Picture in picture", async () => { try { document.pictureInPictureElement ? await document.exitPictureInPicture() : await video.requestPictureInPicture(); } catch {} }) : null;
  const fsBtn = ctl("expand", "Fullscreen", () => { document.fullscreenElement ? document.exitFullscreen() : root.requestFullscreen?.(); });
  const controls = h("div", { class: "vp-controls" }, [seek, h("div", { class: "vp-row" }, [playBtn, h("span", { class: "vp-times" }, [cur, " / ", dur]), h("span", { class: "grow" }), muteBtn, vol, speedBtn, ccBtn, pipBtn, fsBtn])]);
  const resume = resumeAt > 5 ? h("div", { class: "vp-resume" }, [h("span", {}, `Resume from ${fmtTime(resumeAt)}?`), h("button", { class: "btn btn-primary btn-sm", type: "button", "data-vp": "resume", onclick: () => { video.currentTime = resumeAt; play(); resume.remove(); } }, `Resume from ${fmtTime(resumeAt)}`), h("button", { class: "btn btn-secondary btn-sm", type: "button", onclick: () => { video.currentTime = 0; play(); resume.remove(); } }, "Start over")]) : null;
  root.append(video, status, bigPlay, controls, resume);

  captions.forEach((c, i) => {
    const track = h("track", { kind: "subtitles", label: c.label || "Captions", srclang: c.lang || "en", src: URL.createObjectURL(new Blob([c.vtt], { type: "text/vtt" })) });
    video.appendChild(track);
    track.track.mode = "disabled";
  });
  let ccOn = false;
  function toggleCaptions() {
    ccOn = !ccOn;
    [...video.textTracks].forEach((t) => (t.mode = ccOn ? "showing" : "disabled"));
    ccBtn.setAttribute("aria-pressed", String(ccOn)); ccBtn.setAttribute("aria-label", ccOn ? "Captions on" : "Captions off"); ccBtn.classList.toggle("is-on", ccOn);
  }

  // ---- state + tracking ----
  let started = false, maxPercent = 0, lastEmit = 0, completed = false;
  const percent = () => (D() ? (video.currentTime / D()) * 100 : 0);
  const emit = (type) => onEvent?.({ type, position: video.currentTime, duration: D() || 0, percent: percent(), maxPercent });
  const play = () => video.play().catch(() => {});
  function toggle() { video.paused ? play() : video.pause(); }
  function setSpeed(r) { video.playbackRate = r; speedBtn.textContent = `${r}×`; speedBtn.setAttribute("aria-label", `Playback speed ${r}×`); }
  function syncVol() { muteBtn.replaceChildren(ico(video.muted || video.volume === 0 ? "x" : "volume", 18)); muteBtn.setAttribute("aria-label", video.muted ? "Unmute" : "Mute"); vol.value = video.muted ? 0 : video.volume; }
  function paint() {
    const p = percent();
    seek.value = String(Math.round(p * 10));
    seek.style.setProperty("--p", p + "%");
    cur.textContent = fmtTime(video.currentTime);
  }

  video.addEventListener("loadedmetadata", () => { dur.textContent = fmtTime(D()); status.hidden = true; paint(); });
  video.addEventListener("error", () => { status.hidden = false; status.replaceChildren(ico("alert", 20), h("span", {}, "This video can't be played in your browser.")); });
  video.addEventListener("waiting", () => { status.hidden = false; status.replaceChildren(h("span", { class: "spinner" }), h("span", {}, "Buffering…")); });
  video.addEventListener("playing", () => (status.hidden = true));
  video.addEventListener("play", () => { root.classList.remove("is-paused"); playBtn.replaceChildren(ico("pause", 18)); playBtn.setAttribute("aria-label", "Pause"); bigPlay.hidden = true; resume?.remove(); if (!started) { started = true; emit("started"); } else emit("resumed"); });
  video.addEventListener("pause", () => { if (video.ended) return; root.classList.add("is-paused"); playBtn.replaceChildren(ico("play", 18)); playBtn.setAttribute("aria-label", "Play"); bigPlay.hidden = false; emit("paused"); });
  video.addEventListener("ended", () => { root.classList.add("is-paused"); playBtn.replaceChildren(ico("play", 18)); bigPlay.hidden = false; maxPercent = 100; completed = true; emit("completed"); });
  video.addEventListener("timeupdate", () => {
    paint();
    maxPercent = Math.max(maxPercent, percent());
    if (!video.paused && Date.now() - lastEmit > 5000) { lastEmit = Date.now(); emit("progress"); }
  });
  // also report threshold crossings promptly (used by watch-completion rules)
  video.addEventListener("timeupdate", () => { for (const t of [90, 100]) if (percent() >= t - 0.5 && !root.dataset["t" + t]) { root.dataset["t" + t] = "1"; emit("progress"); } });

  // ---- keyboard + touch ----
  root.addEventListener("keydown", (e) => {
    if (e.target.matches("input, select")) { if (e.key !== " ") return; }
    const k = e.key.toLowerCase();
    const map = {
      " ": toggle, k: toggle, arrowright: () => (video.currentTime += 5), arrowleft: () => (video.currentTime -= 5), l: () => (video.currentTime += 10), j: () => (video.currentTime -= 10),
      arrowup: () => { video.volume = Math.min(1, video.volume + 0.1); video.muted = false; syncVol(); }, arrowdown: () => { video.volume = Math.max(0, video.volume - 0.1); syncVol(); },
      m: () => { video.muted = !video.muted; syncVol(); }, f: () => fsBtn.click(), c: () => ccBtn && toggleCaptions(), home: () => (video.currentTime = 0), end: () => (video.currentTime = D() || 0),
    };
    if (/^[0-9]$/.test(k) && D()) { e.preventDefault(); video.currentTime = (+k / 10) * D(); return; }
    if (map[k]) { e.preventDefault(); map[k](); }
  });
  video.addEventListener("click", toggle);
  let idle;
  const wake = () => { root.classList.remove("is-idle"); clearTimeout(idle); idle = setTimeout(() => !video.paused && root.classList.add("is-idle"), 2600); };
  ["mousemove", "touchstart", "focusin"].forEach((ev) => root.addEventListener(ev, wake, { passive: true }));

  // ---- source (may be async: private/signed URLs) ----
  const setSrc = (u) => { video.src = u; syncVol(); };
  if (srcPromise) srcPromise.then(setSrc).catch((err) => { status.hidden = false; status.replaceChildren(ico("lock", 20), h("span", {}, err.message || "You don't have access to this video.")); bigPlay.hidden = true; });
  else if (src) setSrc(src);

  root.player = { video, play, toggle, seek: (t) => (video.currentTime = t), emit };
  return root;
}

function ctl(icon, label, onClick) {
  return h("button", { class: "vp-btn", type: "button", "aria-label": label, title: label, onclick: onClick }, ico(icon, 18));
}
