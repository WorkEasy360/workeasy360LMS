// Community building blocks: Composer, PostCard (with comments + replies + reactions). Used in the Community page and inline in the lesson player.
import { h, timeAgo } from "../lib/dom.js";
import { icon as ico } from "../lib/icons.js";
import { Button } from "./Button.js";
import { Avatar, Badge } from "./Badge.js";
import { Field, Input, Textarea, Select } from "./Form.js";
import { toast } from "./Overlay.js";
import { userById } from "../services/people.js";
import { getCourse, courseTitle, findLesson } from "../services/courses.js";
import { createPost, addComment, toggleReaction, toggleCommentLike, togglePin, REACTIONS, hasExpertAnswer, groups, groupById } from "../services/community.js";

export function Composer({ user, courseId = null, lessonId = null, groupId = null, onPosted, compact = false, defaultKind = "discussion" }) {
  const kind = Select({ options: [{ value: "discussion", label: "Discussion" }, { value: "question", label: "Question for an expert" }, { value: "post", label: "Share a win" }], value: defaultKind, attrs: { "aria-label": "Post type", style: "width:auto;min-width:200px" } });
  const group = Select({ options: [{ value: "", label: "No group" }, ...groups().map((g) => ({ value: g.id, label: g.name }))], value: groupId || "", attrs: { "aria-label": "Group", style: "width:auto;min-width:160px" } });
  const title = Input({ placeholder: defaultKind === "question" ? "What do you want to ask?" : "Start a discussion…", "aria-label": "Title", maxlength: "140" });
  const body = Textarea({ rows: compact ? 2 : 3, placeholder: "Add details (optional)", "aria-label": "Details" });
  const err = h("div", { class: "hint", role: "alert", style: "color:var(--c-danger)", hidden: true });
  const submit = () => {
    const t = title.value.trim();
    if (t.length < 3) { err.textContent = "Add a title of at least 3 characters."; err.hidden = false; title.setAttribute("aria-invalid", "true"); title.focus(); return; }
    createPost({ authorId: user.id, kind: kind.value, title: t, body: body.value.trim(), groupId: courseId ? null : group.value || null, courseId, lessonId });
    title.value = ""; body.value = ""; err.hidden = true; title.removeAttribute("aria-invalid");
    toast("Posted to the community");
    onPosted?.();
  };
  return h("div", { class: "card card-pad stack-sm" }, [
    h("div", { class: "row wrap" }, [Avatar(user, "sm"), h("div", { class: "grow", style: "min-width:200px" }, title)]),
    body, err,
    h("div", { class: "row-between wrap" }, [
      h("div", { class: "row-sm wrap" }, [kind, !courseId && group]),
      Button({ label: "Post", icon: "send", variant: "primary", size: "sm", onClick: submit }),
    ]),
  ]);
}

export function PostCard({ post, user, open = false, onChange, canPin = false }) {
  const card = h("article", { class: "card card-pad post", "aria-labelledby": "post-" + post.id });
  let expanded = open;
  let replyTo = null;

  const bump = () => { draw(); onChange?.(); };

  function comment(c, isReply) {
    const author = userById(c.authorId);
    const liked = c.likes.includes(user.id);
    return h("div", { class: "comment" }, [
      Avatar(author, "sm"),
      h("div", { class: "grow" }, [
        h("div", { class: "comment-body" }, [
          h("div", { class: "row-sm wrap" }, [h("strong", { class: "small" }, author?.name), (author?.role !== "learner") && Badge("Expert", "teal"), h("span", { class: "xs muted" }, timeAgo(c.at))]),
          h("div", { class: "small", style: "white-space:pre-wrap;margin-top:2px" }, c.body),
        ]),
        h("div", { class: "row-sm xs", style: "margin:4px 0 0 8px" }, [
          h("button", { class: "btn btn-ghost btn-sm", type: "button", "aria-pressed": String(liked), style: liked ? "color:var(--c-primary)" : "", onclick: () => { toggleCommentLike(post.id, c.id, user.id); bump(); } }, [ico("thumbs", 14), c.likes.length || "Like"]),
          !isReply && h("button", { class: "btn btn-ghost btn-sm", type: "button", onclick: () => { replyTo = replyTo === c.id ? null : c.id; draw(); card.querySelector(`[data-reply="${c.id}"] input`)?.focus(); } }, [ico("message", 14), "Reply"]),
        ]),
        replyTo === c.id && composerRow("Write a reply…", c.id),
      ]),
    ]);
  }

  function composerRow(placeholder, parentId) {
    const input = h("input", { class: "input", placeholder, "aria-label": placeholder, onkeydown: (e) => e.key === "Enter" && send() });
    const send = () => {
      const v = input.value.trim();
      if (!v) return input.focus();
      addComment(post.id, { authorId: user.id, body: v, parentId });
      replyTo = null; expanded = true; bump();
    };
    return h("div", { class: "row-sm", "data-reply": parentId || "root", style: "margin-top:8px" }, [Avatar(user, "sm"), input, Button({ icon: "send", variant: "soft", size: "sm", title: "Send", onClick: send })]);
  }

  function draw() {
    const author = userById(post.authorId);
    const course = post.courseId ? getCourse(post.courseId) : null;
    const lesson = course && post.lessonId ? findLesson(course, post.lessonId) : null;
    const group = post.groupId ? groupById(post.groupId) : null;
    const top = post.comments.filter((c) => !c.parentId);
    card.replaceChildren(
      h("div", { class: "row" }, [
        Avatar(author),
        h("div", { class: "grow" }, [
          h("div", { class: "row-sm wrap" }, [h("strong", {}, author?.name), author?.role !== "learner" && Badge("Expert", "teal"), h("span", { class: "small muted" }, `${author?.title || ""} · ${timeAgo(post.at)}`)]),
          h("div", { class: "row-sm wrap", style: "margin-top:2px" }, [
            post.pinned && Badge("Pinned", "warning", "pin"), post.kind === "question" && Badge("Question", "info"), post.kind === "question" && hasExpertAnswer(post) && Badge("Expert answered", "success", "check"),
            group && Badge(group.name, ""), course && Badge(lesson ? `${courseTitle(course)} › ${lesson.title}` : courseTitle(course), "primary", "book"),
          ]),
        ]),
        canPin && Button({ icon: "pin", variant: "ghost", size: "sm", title: post.pinned ? "Unpin discussion" : "Pin discussion", onClick: () => { togglePin(post.id); bump(); } }),
      ]),
      h("h3", { id: "post-" + post.id }, post.title),
      post.body && h("p", { class: "post-body" }, post.body),
      h("div", { class: "react-bar" }, [
        ...Object.entries(REACTIONS).map(([type, r]) => {
          const on = post.reactions[type].includes(user.id);
          return h("button", { class: "react-btn", type: "button", "aria-pressed": String(on), "aria-label": `${r.label}, ${post.reactions[type].length}`, onclick: () => { toggleReaction(post.id, type, user.id); bump(); } }, [ico(r.icon, 15), post.reactions[type].length || r.label]);
        }),
        h("span", { class: "grow" }),
        h("button", { class: "btn btn-ghost btn-sm", type: "button", "aria-expanded": String(expanded), onclick: () => { expanded = !expanded; draw(); } }, [ico("message", 16), `${post.comments.length} ${post.comments.length === 1 ? "reply" : "replies"}`, ico(expanded ? "chevron-up" : "chevron-down", 14)]),
      ]),
      expanded && h("div", { class: "stack", style: "margin-top:4px" }, [
        ...top.map((c) => h("div", { class: "stack-sm" }, [comment(c, false), post.comments.some((r) => r.parentId === c.id) && h("div", { class: "replies" }, post.comments.filter((r) => r.parentId === c.id).map((r) => comment(r, true)))])),
        !top.length && h("div", { class: "small muted" }, "No replies yet — be the first."),
        composerRow("Write a reply…", null),
      ])
    );
  }
  draw();
  return card;
}
