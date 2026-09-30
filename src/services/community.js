import { load, save, isBackendOnline } from "../lib/store.js";
import { bus } from "../lib/events.js";
import { uid } from "../lib/dom.js";
import { notify, userById } from "./people.js";
import { api } from "./api.js";

const bg = (label, promise) => { if (isBackendOnline()) promise.catch((err) => console.warn(`[community] ${label} sync failed:`, err.message)); };

export const REACTIONS = { like: { icon: "thumbs", label: "Like" }, insight: { icon: "bulb", label: "Insightful" }, celebrate: { icon: "sparkles", label: "Celebrate" } };

export const groups = () => load("groups");
export const groupById = (id) => groups().find((g) => g.id === id) || null;
export const postById = (id) => load("posts").find((p) => p.id === id) || null;

export function listPosts({ groupId, kind, q, courseId, lessonId, pinnedOnly } = {}) {
  const needle = (q || "").trim().toLowerCase();
  return load("posts")
    .filter((p) => (!groupId || p.groupId === groupId) && (!kind || p.kind === kind) && (!courseId || p.courseId === courseId) && (!lessonId || p.lessonId === lessonId) && (!pinnedOnly || p.pinned))
    .filter((p) => !needle || `${p.title} ${p.body} ${userById(p.authorId)?.name} ${p.comments.map((c) => c.body).join(" ")}`.toLowerCase().includes(needle))
    .sort((a, b) => (b.pinned - a.pinned) || b.at - a.at);
}

export function createPost({ authorId, kind = "discussion", title, body, groupId = null, courseId = null, lessonId = null }) {
  const post = { id: uid("p"), authorId, kind, title, body, at: Date.now(), groupId, courseId, lessonId, pinned: false, reactions: { like: [], insight: [], celebrate: [] }, comments: [] };
  load("posts").unshift(post);
  save("posts");
  bus.emit("post.created", { postId: post.id, courseId, lessonId });
  bg("post", api.createPost({ id: post.id, kind, title, body, groupId, courseId, lessonId }));
  return post;
}

export function addComment(postId, { authorId, body, parentId = null }) {
  const post = postById(postId);
  if (!post) return null;
  const c = { id: uid("cm"), authorId, body, at: Date.now(), parentId, likes: [] };
  post.comments.push(c);
  save("posts");
  const parent = parentId ? post.comments.find((x) => x.id === parentId) : null;
  const target = parent ? parent.authorId : post.authorId;
  if (target !== authorId) notify(target, { kind: "reply", title: `${userById(authorId)?.name.split(" ")[0]} replied to your ${parent ? "comment" : "post"}`, body: body.slice(0, 90), href: "/community" });
  bus.emit("comment.added", { postId, commentId: c.id });
  bg("comment", api.addComment(postId, c.id, body, parentId));
  return c;
}

export function toggleReaction(postId, type, userId) {
  const p = postById(postId);
  const list = p.reactions[type];
  const i = list.indexOf(userId);
  i >= 0 ? list.splice(i, 1) : list.push(userId);
  save("posts");
  bg("reaction", api.reactToPost(postId, type));
}
export function toggleCommentLike(postId, commentId, userId) {
  const c = postById(postId).comments.find((x) => x.id === commentId);
  const i = c.likes.indexOf(userId);
  i >= 0 ? c.likes.splice(i, 1) : c.likes.push(userId);
  save("posts");
  bg("comment reaction", api.reactToComment(commentId, postId, "like"));
}
export function togglePin(postId) {
  const p = postById(postId);
  p.pinned = !p.pinned;
  save("posts");
  bg("pin", api.togglePinPost(postId));
}

export function toggleMembership(groupId, userId) {
  const g = groupById(groupId);
  const i = g.members.indexOf(userId);
  i >= 0 ? g.members.splice(i, 1) : g.members.push(userId);
  save("groups");
  bg("group membership", api.toggleGroupMembership(groupId));
}

export const totalReactions = (p) => Object.values(p.reactions).reduce((n, a) => n + a.length, 0);
export const hasExpertAnswer = (p) => p.comments.some((c) => userById(c.authorId)?.role === "instructor" || userById(c.authorId)?.role === "admin");
