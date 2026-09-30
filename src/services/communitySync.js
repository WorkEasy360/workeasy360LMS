// Pulls community posts/comments/reactions and groups from the backend into the local cache on login/refresh —
// same additive merge pattern as courseSync.js / learningSync.js.
import { api } from "./api.js";
import { isBackendOnline, load, replace } from "../lib/store.js";

function toLocalPost(dto) {
  return {
    id: dto.id, authorId: dto.authorId, kind: dto.kind, title: dto.title, body: dto.body,
    at: new Date(dto.createdAt).getTime(), groupId: dto.groupId, courseId: dto.courseId, lessonId: dto.lessonId,
    pinned: dto.pinned, reactions: { like: dto.reactions.like || [], insight: dto.reactions.insight || [], celebrate: dto.reactions.celebrate || [] },
    comments: (dto.comments || []).map((c) => ({ id: c.id, authorId: c.authorId, body: c.body, at: new Date(c.createdAt).getTime(), parentId: c.parentId, likes: c.likedBy || [] })),
  };
}

export async function hydrateCommunity() {
  if (!isBackendOnline()) return;
  try {
    const [posts, groups] = await Promise.all([api.posts(), api.groups()]);
    const local = load("posts");
    const byId = new Map(local.map((p) => [p.id, p]));
    posts.forEach((dto) => byId.set(dto.id, toLocalPost(dto)));
    replace("posts", [...byId.values()].sort((a, b) => (b.pinned - a.pinned) || b.at - a.at));

    const localGroups = load("groups");
    const byGid = new Map(localGroups.map((g) => [g.id, g]));
    groups.forEach((g) => byGid.set(g.id, { id: g.id, name: g.name, description: g.description, hue: g.hue, members: g.members }));
    replace("groups", [...byGid.values()]);
  } catch (err) {
    console.warn("[communitySync] could not hydrate community data from backend:", err.message);
  }
}
