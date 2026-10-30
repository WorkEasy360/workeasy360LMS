// Community: feed, groups, discussions, questions for experts, search, pinned posts. Connected to courses and lessons.
import { h, pluralize } from "../lib/dom.js";
import { bus } from "../lib/events.js";
import { icon as ico } from "../lib/icons.js";
import { Button } from "../components/Button.js";
import { Tabs } from "../components/Tabs.js";
import { SearchInput } from "../components/Form.js";
import { PageHeader, Card } from "../components/Card.js";
import { Badge } from "../components/Badge.js";
import { EmptyState, withLoading } from "../components/States.js";
import { Composer, PostCard } from "../components/Post.js";
import { toast } from "../components/Overlay.js";
import { listPosts, groups, toggleMembership, hasExpertAnswer } from "../services/community.js";

export function CommunityPage(ctx) {
  const user = ctx.user;
  const canModerate = user.role !== "learner";
  let tab = "all", groupId = null, q = "";
  const focusPost = ctx.query.post || null;
  const feed = h("div", { class: "stack" });
  const side = h("div", { class: "stack" });
  const tabHost = h("div");

  function drawFeed() {
    let posts = listPosts({ groupId, q, kind: tab === "questions" ? "question" : tab === "discussions" ? "discussion" : undefined, pinnedOnly: tab === "pinned" });
    if (tab === "unanswered") posts = posts.filter((p) => p.kind === "question" && !hasExpertAnswer(p));
    feed.replaceChildren(
      Composer({ user, groupId, onPosted: () => { drawFeed(); drawSide(); }, defaultKind: tab === "questions" ? "question" : "discussion" }),
      ...(posts.length ? posts.map((p) => PostCard({ post: p, user, open: p.id === focusPost, canPin: canModerate, onChange: () => { drawSide(); } })) : [Card(EmptyState({ icon: "message", title: q ? "No conversations match your search" : "No conversations here yet", description: q ? "Try different words." : "Be the first to start one." }))])
    );
    if (focusPost) feed.querySelector(`#post-${focusPost}`)?.scrollIntoView({ block: "center" });
  }

  function drawSide() {
    const all = listPosts();
    side.replaceChildren(
      Card(h("div", { class: "stack-sm" }, [
        h("button", { class: "group-item", type: "button", "aria-pressed": String(!groupId), onclick: () => { groupId = null; drawFeed(); drawSide(); } }, [h("span", { class: "group-dot", style: "background:var(--c-text)" }, ico("grid", 16)), h("span", { class: "grow" }, "All conversations"), h("span", { class: "xs muted" }, all.length)]),
        h("div", { class: "eyebrow", style: "margin:10px 12px 2px" }, "Groups"),
        ...groups().map((g) => {
          const joined = g.members.includes(user.id);
          return h("div", { class: "row-sm" }, [
            h("button", { class: "group-item grow", type: "button", "aria-pressed": String(groupId === g.id), onclick: () => { groupId = g.id; drawFeed(); drawSide(); } }, [h("span", { class: "group-dot", style: `background:hsl(${g.hue} 55% 45%)` }, g.name[0]), h("span", { class: "grow" }, [g.name, h("span", { class: "xs muted", style: "display:block;font-weight:400" }, pluralize(g.members.length, "member"))])]),
            Button({ icon: joined ? "check" : "plus", size: "sm", variant: joined ? "soft" : "ghost", title: joined ? `Leave ${g.name}` : `Join ${g.name}`, onClick: () => { toggleMembership(g.id, user.id); toast(joined ? `Left ${g.name}` : `Joined ${g.name}`, { type: "info" }); drawSide(); } }),
          ]);
        }),
      ]), { pad: true }),
      Card(h("div", { class: "stack-sm" }, [h("div", { class: "row-sm strong small" }, [ico("bulb", 18), "Ask an expert"]), h("p", { class: "small muted" }, "Choose “Question for an expert” when posting — instructors are notified and answers are marked."), h("div", { class: "small" }, `${listPosts({ kind: "question" }).filter((p) => !hasExpertAnswer(p)).length} open questions`)]))
    );
  }

  const tabs = [{ id: "all", label: "Feed" }, { id: "discussions", label: "Discussions" }, { id: "questions", label: "Questions" }, ...(canModerate ? [{ id: "unanswered", label: "Unanswered" }] : []), { id: "pinned", label: "Pinned" }];
  tabHost.appendChild(Tabs({ tabs, active: tab, onChange: (t) => { tab = t; drawFeed(); }, label: "Community filters" }));

  const el = h("div", { class: "stack-lg" }, [
    PageHeader({ title: "Community", sub: "Learn with your colleagues. Discussions live next to the courses they're about." }),
    h("div", { class: "community" }, [
      side,
      h("div", { class: "stack" }, [h("div", { class: "row-between wrap" }, [tabHost, h("div", { style: "width:min(260px,100%)" }, SearchInput({ placeholder: "Search conversations", onInput: (v) => { q = v; drawFeed(); } }))]), feed]),
    ]),
  ]);
  drawSide();
  const stop = withLoading(feed, () => { drawFeed(); return [...feed.childNodes]; }, { delay: 180, skeleton: () => h("div", { class: "stack" }, [1, 2].map(() => h("div", { class: "skeleton", style: "height:150px" }))) });
  // Live updates from other users — skipped while this person is typing so an open draft is never discarded.
  ["data:posts", "data:groups"].forEach((ev) => bus.on(ev, () => {
    if (!feed.isConnected) return;
    const a = document.activeElement;
    if (a && el.contains(a) && (a.isContentEditable || a.value)) return;
    drawFeed(); drawSide();
  }));
  return { title: "Community", crumbs: [{ label: "Community" }], el, destroy: stop };
}
