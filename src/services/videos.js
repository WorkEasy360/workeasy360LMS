// Video model + storage abstraction + learning tracking.
//
// Video { sourceType: "native" | "youtube" | "vimeo" | "external", sourceUrl, storageKey, thumbnail, duration,
//         width, height, size, mime, fileName, title, description, captions: [{ id, lang, label, vtt }], transcript,
//         visibility: "course" | "organisation", status: "ready", createdAt }
//
// Native uploads go through a VideoStorage. The bundled LocalVideoStorage keeps files in this browser's IndexedDB so the
// whole workflow works with no backend. It is NOT secure delivery: production replaces it with object storage + CDN +
// transcoding, and getPlaybackUrl() returns short-lived signed URLs after a server-side course-permission check.
import { load, save } from "../lib/store.js";
import { bus } from "../lib/events.js";
import { uid } from "../lib/dom.js";
import { settings } from "./people.js";
import { can } from "./permissions.js";
import { getEnrollment } from "./learning.js";
import { api, getToken, API_BASE } from "./api.js";

export const ACCEPTED_TYPES = ["video/mp4", "video/webm", "video/quicktime"];
export const ACCEPTED_EXT = [".mp4", ".webm", ".mov"];
export const SOURCE_LABEL = { native: "Uploaded", youtube: "YouTube", vimeo: "Vimeo", external: "External URL" };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const fmtTime = (s) => {
  s = Math.max(0, Math.round(s || 0));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return (h ? `${h}:${String(m).padStart(2, "0")}` : String(m).padStart(2, "0")) + ":" + String(sec).padStart(2, "0");
};
export const fmtSize = (b) => (b > 1e9 ? (b / 1e9).toFixed(1) + " GB" : b > 1e6 ? (b / 1e6).toFixed(1) + " MB" : Math.max(1, Math.round(b / 1e3)) + " KB");

// ---------- model helpers ----------
export function detectSource(url) {
  const u = (url || "").trim();
  if (!/^https?:\/\//i.test(u)) return { error: "Enter a full link starting with https://" };
  const yt = u.match(/(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([\w-]{11})/);
  if (yt) return { sourceType: "youtube", embedUrl: `https://www.youtube-nocookie.com/embed/${yt[1]}`, sourceUrl: u, thumbnail: `https://img.youtube.com/vi/${yt[1]}/hqdefault.jpg` };
  const vm = u.match(/vimeo\.com\/(?:video\/)?(\d+)/);
  if (vm) return { sourceType: "vimeo", embedUrl: `https://player.vimeo.com/video/${vm[1]}`, sourceUrl: u };
  return { sourceType: "external", sourceUrl: u };
}

export function newVideo(partial = {}) {
  return { id: uid("v"), sourceType: "native", sourceUrl: "", storageKey: "", thumbnail: "", duration: 0, width: 0, height: 0, size: 0, mime: "", fileName: "", title: "", description: "", captions: [], transcript: "", visibility: "course", status: "ready", createdAt: Date.now(), ...partial };
}

// Old blocks stored {url, caption}; normalise to the provider model.
export function videoOf(block) {
  if (block.video !== undefined) return block.video;
  if (block.url) { const d = detectSource(block.url); return d.error ? null : newVideo({ ...d, title: block.caption || "" }); }
  return null;
}

export function validateFile(file) {
  const ext = "." + (file.name.split(".").pop() || "").toLowerCase();
  if (!ACCEPTED_TYPES.includes(file.type) && !ACCEPTED_EXT.includes(ext)) return "That file type isn't supported. Use MP4, WebM or MOV.";
  const max = (settings().maxVideoMB || 200) * 1024 * 1024;
  if (file.size > max) return `That file is ${fmtSize(file.size)}. The maximum is ${settings().maxVideoMB || 200} MB.`;
  if (file.size === 0) return "That file is empty.";
  return null;
}

// ---------- storage abstraction ----------
export class VideoStorage {
  /** @returns {Promise<{storageKey:string,size:number,mime:string}>} */
  async upload(file, { onProgress, signal } = {}) { throw new Error("not implemented"); }
  /** Resolve a playable URL for an authorised viewer. Production: signed, expiring CDN URL. */
  async getPlaybackUrl(storageKey, access) { throw new Error("not implemented"); }
  async remove(storageKey) {}
}

class LocalVideoStorage extends VideoStorage {
  constructor() { super(); this.dbp = null; this.urls = new Map(); }
  db() {
    return (this.dbp ||= new Promise((resolve, reject) => {
      const req = indexedDB.open("we360-video", 1);
      req.onupgradeneeded = () => req.result.createObjectStore("blobs");
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    }));
  }
  async put(key, blob) {
    const db = await this.db();
    return new Promise((res, rej) => { const tx = db.transaction("blobs", "readwrite"); tx.objectStore("blobs").put(blob, key); tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
  }
  async get(key) {
    const db = await this.db();
    return new Promise((res, rej) => { const r = db.transaction("blobs").objectStore("blobs").get(key); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  }
  async upload(file, { onProgress, signal } = {}) {
    // Read in chunks so the progress is real, and pace it so the UI is legible for small files.
    const chunk = Math.max(256 * 1024, Math.ceil(file.size / 20));
    let read = 0;
    const t0 = Date.now();
    while (read < file.size) {
      if (signal?.aborted) throw new DOMException("Upload cancelled", "AbortError");
      await file.slice(read, read + chunk).arrayBuffer();
      read = Math.min(file.size, read + chunk);
      const wait = Math.max(0, (t0 + 1800 * (read / file.size)) - Date.now());
      if (wait) await sleep(wait);
      onProgress?.(read / file.size);
    }
    if (signal?.aborted) throw new DOMException("Upload cancelled", "AbortError");
    const storageKey = `vid_${uid("k")}`;
    await this.put(storageKey, file);
    return { storageKey, size: file.size, mime: file.type || "video/mp4" };
  }
  async getPlaybackUrl(storageKey, access) {
    if (!access?.allowed) throw new Error("You don't have access to this video.");
    if (this.urls.has(storageKey)) return this.urls.get(storageKey);
    const blob = await this.get(storageKey);
    if (!blob) throw new Error("This video file isn't available in this browser.");
    const url = URL.createObjectURL(blob);
    this.urls.set(storageKey, url);
    return url;
  }
  async remove(storageKey) {
    const db = await this.db();
    this.urls.delete(storageKey);
    return new Promise((res) => { const tx = db.transaction("blobs", "readwrite"); tx.objectStore("blobs").delete(storageKey); tx.oncomplete = res; tx.onerror = res; });
  }
}
// Real backend implementation: uploads to the Java service (backend/, see VideoController/LocalVideoStorageService)
// so a video really lives on a server and survives across browsers/devices, not just this one browser's IndexedDB.
class RemoteVideoStorage extends VideoStorage {
  upload(file, { onProgress, signal, courseId, title } = {}) {
    return new Promise((resolve, reject) => {
      const form = new FormData();
      form.append("file", file);
      if (courseId) form.append("courseId", courseId);
      if (title) form.append("title", title);
      const xhr = new XMLHttpRequest();
      xhr.open("POST", API_BASE + "/videos");
      const token = getToken();
      if (token) xhr.setRequestHeader("Authorization", "Bearer " + token);
      xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(e.loaded / e.total);
      xhr.onerror = () => reject(new Error("Upload failed — check your connection and try again."));
      xhr.onabort = () => reject(new DOMException("Upload cancelled", "AbortError"));
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          const v = JSON.parse(xhr.responseText);
          resolve({ storageKey: v.id, size: v.fileSize ?? file.size, mime: v.mimeType || file.type });
        } else {
          let message = `Upload failed (${xhr.status})`;
          try { message = JSON.parse(xhr.responseText).message || message; } catch {}
          reject(new Error(message));
        }
      };
      signal?.addEventListener("abort", () => xhr.abort());
      xhr.send(form);
    });
  }
  async getPlaybackUrl(storageKey) { return api.videoStreamUrl(storageKey); }
  async remove(storageKey) { try { await api.deleteVideo(storageKey); } catch (err) { console.warn("[videos] backend delete failed:", err.message); } }
}
const localVideoStorage = new LocalVideoStorage();
const remoteVideoStorage = new RemoteVideoStorage();

// Dispatches to the real backend whenever it's reachable (checked per call, not just at boot, so signing in
// mid-session switches over immediately); falls back to the local, zero-install IndexedDB store otherwise —
// e.g. offline demos, or this dev environment before the backend was stood up.
export const videoStorage = {
  upload: (file, opts) => (getToken() ? remoteVideoStorage : localVideoStorage).upload(file, opts),
  getPlaybackUrl: (storageKey, access) => (getToken() ? remoteVideoStorage : localVideoStorage).getPlaybackUrl(storageKey, access),
  remove: (storageKey) => (getToken() ? remoteVideoStorage : localVideoStorage).remove(storageKey),
  get: (storageKey) => localVideoStorage.get(storageKey), // local-only helper (dev/self-test introspection)
};

// Access decision made before any playback URL is issued (mirrors the server-side check production needs).
export function videoAccess(user, course) {
  if (!user || !course) return { allowed: false };
  if (can(user, "course.view", course) || can(user, "course.edit", course)) return { allowed: true };
  return { allowed: !!getEnrollment(user.id, course.id) && course.status === "published" };
}
export async function playbackUrl(video, user, course) {
  if (video.sourceType === "native") return videoStorage.getPlaybackUrl(video.storageKey, videoAccess(user, course));
  return video.sourceUrl;
}

// ---------- processing (metadata + thumbnail) ----------
export async function processVideo(file, { onStage } = {}) {
  const out = { duration: 0, width: 0, height: 0, thumbnail: "", warning: "" };
  onStage?.("processing");
  await sleep(450);
  const url = URL.createObjectURL(file);
  const v = document.createElement("video");
  v.muted = true; v.preload = "metadata"; v.playsInline = true; v.src = url;
  try {
    await new Promise((res, rej) => { v.onloadedmetadata = res; v.onerror = () => rej(new Error("decode")); setTimeout(() => rej(new Error("timeout")), 6000); });
    if (!isFinite(v.duration)) { v.currentTime = 1e6; await new Promise((r) => { v.ontimeupdate = () => { v.ontimeupdate = null; r(); }; setTimeout(r, 1500); }); }
    out.duration = isFinite(v.duration) ? v.duration : 0; out.width = v.videoWidth; out.height = v.videoHeight;
    onStage?.("thumbnail");
    await sleep(450);
    v.currentTime = Math.min(1, (out.duration || 2) * 0.1);
    await new Promise((res) => { v.onseeked = res; setTimeout(res, 2500); });
    const w = 320, ratio = v.videoHeight && v.videoWidth ? v.videoHeight / v.videoWidth : 9 / 16;
    const c = document.createElement("canvas"); c.width = w; c.height = Math.round(w * ratio);
    c.getContext("2d").drawImage(v, 0, 0, c.width, c.height);
    out.thumbnail = c.toDataURL("image/jpeg", 0.72);
  } catch (err) {
    out.warning = "We couldn't read this file's details in the browser (it may use a codec browsers can't preview). It was uploaded, but a thumbnail and duration weren't generated.";
    onStage?.("thumbnail");
    await sleep(300);
  } finally {
    URL.revokeObjectURL(url);
  }
  return out;
}

export async function fileToThumbnail(file) {
  const bmp = await createImageBitmap(file);
  const w = Math.min(480, bmp.width), c = document.createElement("canvas");
  c.width = w; c.height = Math.round((bmp.height / bmp.width) * w);
  c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
  return c.toDataURL("image/jpeg", 0.75);
}

export async function readCaptions(file) {
  let text = await file.text();
  if (/\.srt$/i.test(file.name) || !/^﻿?WEBVTT/.test(text)) text = "WEBVTT\n\n" + text.replace(/\r/g, "").replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, "$1.$2");
  return { id: uid("cc"), lang: "en", label: file.name.replace(/\.[^.]+$/, "") || "English", vtt: text };
}

// ---------- learning tracking ----------
// evt: { type: "started"|"progress"|"paused"|"resumed"|"completed", position, duration, percent, maxPercent }
export function recordVideoEvent(userId, courseId, lessonId, blockId, evt) {
  const e = getEnrollment(userId, courseId);
  if (!e) return null;
  const vp = ((e.videoProgress ||= {})[blockId] ||= { position: 0, duration: 0, percent: 0, maxPercent: 0, completed: false, startedAt: Date.now() });
  vp.position = evt.type === "completed" ? 0 : evt.position;
  vp.duration = evt.duration || vp.duration;
  vp.percent = evt.percent;
  vp.maxPercent = Math.max(vp.maxPercent, evt.maxPercent ?? evt.percent);
  vp.lastPosition = evt.position;
  if (evt.type === "completed") vp.completed = true;
  vp.updatedAt = Date.now();
  e.lastActiveAt = Date.now();
  const log = load("videoEvents");
  if (evt.type !== "progress") { log.push({ userId, courseId, lessonId, blockId, type: evt.type, position: Math.round(evt.position), percent: Math.round(evt.percent), at: Date.now() }); if (log.length > 1000) log.splice(0, log.length - 1000); }
  save("enrollments");
  if (evt.type !== "progress") save("videoEvents");
  bus.emit(`video.${evt.type}`, { userId, courseId, lessonId, blockId, percent: evt.percent, maxPercent: vp.maxPercent });
  syncVideoProgress(lessonId, blockId, vp, evt.type);
  return vp;
}

// Backend persistence of watch position. Pause/resume/complete go straight through; the 5-second "progress"
// heartbeat is throttled so a long watch doesn't hammer the API. Local state stays the instant source for the UI.
const lastSyncAt = new Map();
const SYNC_EVERY_MS = 8000;
export function syncVideoProgress(lessonId, blockId, vp, type = "progress", { keepalive = false } = {}) {
  if (!getToken() || !vp) return;
  const now = Date.now();
  if (type === "progress" && now - (lastSyncAt.get(blockId) || 0) < SYNC_EVERY_MS) return;
  lastSyncAt.set(blockId, now);
  api.updateLessonProgress(lessonId, { lastPosition: vp.lastPosition || 0, watchPercentage: vp.percent || 0, videoCompleted: !!vp.completed }, { keepalive })
    .catch((err) => console.warn("[videos] progress sync failed:", err.message));
}
export const getVideoProgress = (userId, courseId, blockId) => getEnrollment(userId, courseId)?.videoProgress?.[blockId] || null;

// Completion rule on a lesson: { rule: "manual" | "watch90" | "watch100" }
export const COMPLETION_RULES = [
  { id: "manual", label: "Mark lesson complete manually", threshold: null },
  { id: "watch90", label: "Complete when the video reaches 90%", threshold: 90 },
  { id: "watch100", label: "Complete when the video reaches 100%", threshold: 100 },
];
export const completionThreshold = (lesson) => COMPLETION_RULES.find((r) => r.id === (lesson.completion?.rule || "manual"))?.threshold ?? null;
