package com.workeasy360.backend.ai;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.workeasy360.backend.util.Json;

import java.util.ArrayList;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Deterministic local provider used when AI is disabled (AI_ENABLED=false) or AI_PROVIDER=mock. It never calls the
 * network: the outline / questions are derived purely from the request (topic, objectives, source text), so the
 * same input always yields the same result and automated tests need no API key. It is clearly labelled as
 * `mock` in every generation record and in /api/ai/status — it does not pretend to be a real model.
 *
 * Test hook: an input containing the token `__malformed__` makes the mock return text that is not JSON, so the
 * malformed-response path (retry once, then a recoverable error) can be exercised deterministically.
 */
public class MockAiProvider implements AiProvider {
    public static final String MALFORMED_TOKEN = "__malformed__";

    @Override public String name() { return "mock"; }
    @Override public String model() { return "deterministic-mock-v1"; }
    @Override public boolean configured() { return true; }

    @Override public Completion generateCourse(Prompt prompt) {
        if (prompt.user().contains(MALFORMED_TOKEN)) return new Completion("Sorry, here is the course: {title: unquoted, modules: [", name(), model());
        Fields f = Fields.parse(prompt.user());
        ObjectNode course = Json.MAPPER.createObjectNode();
        course.put("title", f.topic.isBlank() ? "New course" : f.topic);
        course.put("summary", "A " + f.difficulty.toLowerCase() + "-level course on " + f.topic + " for " + f.audience + ", built around " + f.objectives.size() + " learning objective" + (f.objectives.size() == 1 ? "" : "s") + ".");
        ArrayNode modules = course.putArray("modules");
        List<String> moduleTitles = new ArrayList<>();
        moduleTitles.add("Foundations of " + f.topic);
        for (String o : f.objectives) if (moduleTitles.size() < 6) moduleTitles.add(titleCase(o));
        if (moduleTitles.size() < 3) moduleTitles.add(f.topic + " in practice");
        int perModule = Math.max(10, f.durationMinutes / moduleTitles.size());
        for (int i = 0; i < moduleTitles.size(); i++) {
            String mt = moduleTitles.get(i);
            String objective = i == 0 ? "Understand the core ideas behind " + f.topic : f.objectives.get(Math.min(i - 1, f.objectives.size() - 1));
            ObjectNode m = modules.addObject();
            m.put("title", mt);
            m.put("description", "Covers: " + objective + ".");
            ArrayNode lessons = m.putArray("lessons");
            String src = f.sourceSnippet(i);
            String srcName = f.sourceName(i);
            ObjectNode reading = lessons.addObject();
            reading.put("title", "Introduction to " + mt.toLowerCase()); reading.put("type", "reading"); reading.put("objective", objective); reading.put("durationMin", Math.max(5, perModule / 3));
            ArrayNode rb = reading.putArray("blocks");
            block(rb, "heading", "Why this matters for " + f.audience, null, null);
            block(rb, "text", "This lesson introduces " + mt.toLowerCase() + ". By the end you will be able to: " + objective + ".", null, null);
            if (src != null) block(rb, "callout", "From the source material: " + src, null, srcName);
            reading.putArray("activities").add("Write down one situation at work where " + objective.toLowerCase() + " would apply.");
            reading.putNull("quiz"); reading.putNull("assignment");
            ObjectNode practice = lessons.addObject();
            practice.put("title", mt + " in practice"); practice.put("type", "lesson"); practice.put("objective", objective); practice.put("durationMin", Math.max(5, perModule / 3));
            ArrayNode pb = practice.putArray("blocks");
            block(pb, "heading", "Step by step", null, null);
            ArrayNode items = Json.MAPPER.createArrayNode();
            items.add("Recognise when " + objective.toLowerCase() + " is needed"); items.add("Apply the approach to a real example"); items.add("Check the outcome and adjust");
            block(pb, "checklist", "Practice checklist", items, null);
            block(pb, "text", "Work through the checklist with a recent example from your own role. " + (src != null ? "Compare your approach with the source material." : ""), null, src != null ? srcName : null);
            practice.putArray("activities").add("Pair up and rehearse " + objective.toLowerCase() + " for five minutes; swap roles.");
            practice.putNull("quiz"); practice.putNull("assignment");
            ObjectNode quiz = lessons.addObject();
            quiz.put("title", "Check your understanding: " + mt.toLowerCase()); quiz.put("type", "quiz"); quiz.put("objective", objective); quiz.put("durationMin", 5);
            quiz.putArray("blocks"); quiz.putArray("activities"); quiz.putNull("assignment");
            ObjectNode q = quiz.putObject("quiz"); q.put("passScore", 70);
            q.set("questions", questions(List.of(objective), 3, f.difficulty.toLowerCase().equals("advanced") ? "hard" : "medium", "mixed", src, srcName, i * 3));
        }
        return new Completion(course.toString(), name(), model());
    }

    /** Grounded coach turn: reads the "Learner context (JSON)" / "Current lesson (JSON)" blocks and answers only from them. */
    @Override public Completion generateCoach(Prompt prompt) {
        if (prompt.user().contains(MALFORMED_TOKEN)) return new Completion("I think you should… {reply: 'unquoted'", name(), model());
        String u = prompt.user();
        JsonNode ctx = block(u, "Learner context (JSON):\n"), lesson = block(u, "Current lesson (JSON):\n");
        String question = u.substring(u.lastIndexOf("Question: ") + 10).trim().toLowerCase();
        ObjectNode out = Json.MAPPER.createObjectNode();
        ArrayNode actions = out.putArray("actions");
        String name = ctx == null ? "there" : ctx.path("learner").path("name").asText("there").split(" ")[0];
        JsonNode recs = ctx == null ? Json.MAPPER.createArrayNode() : ctx.path("recommendations");
        JsonNode top = recs.isArray() && !recs.isEmpty() ? recs.get(0) : null;
        JsonNode courses = ctx == null ? Json.MAPPER.createArrayNode() : ctx.path("courses");
        Integer minutes = null; java.util.regex.Matcher mm = Pattern.compile("(\\d{1,3})\\s*-?\\s*min").matcher(question); if (mm.find()) minutes = Integer.parseInt(mm.group(1));
        boolean wantsPlan = question.contains("plan") || minutes != null || question.contains("today") || question.contains("session");
        StringBuilder reply = new StringBuilder();
        if (ctx == null) { reply.append("I can't see your learning data right now, so I can't recommend anything specific yet."); }
        else if (lesson != null && (question.contains("explain") || question.contains("remember") || question.contains("this lesson") || question.contains("practice question") || question.contains("relate"))) {
            String content = lesson.path("content").asText(""); String[] sents = content.split("(?<=[.!?])\\s+");
            reply.append("You're learning “").append(lesson.path("title").asText()).append("”");
            if (lesson.hasNonNull("courseTitle")) reply.append(" in ").append(lesson.path("courseTitle").asText());
            reply.append(".\n");
            if (content.isBlank()) reply.append("This lesson has no written content available to me, so I can only go by its title.");
            else if (question.contains("practice question")) reply.append("Practice question: In your own words, what is the key idea of this line — “").append(sents[0].length() > 160 ? sents[0].substring(0, 157) + "…" : sents[0]).append("”?");
            else { reply.append("Key points from the lesson:"); for (int i = 0; i < Math.min(3, sents.length); i++) reply.append("\n- ").append(sents[i].length() > 180 ? sents[i].substring(0, 177) + "…" : sents[i]); }
            if (question.contains("relate")) { JsonNode sk = ctx.path("skills"); if (sk.isArray() && !sk.isEmpty()) reply.append("\nThe skill it builds most directly for you is ").append(sk.get(0).path("name").asText()).append(" (currently ").append(sk.get(0).path("level").asText()).append(", ").append(sk.get(0).path("pct").asInt()).append("%)."); }
            if (lesson.hasNonNull("courseId")) { ObjectNode a = actions.addObject(); a.put("type", "CONTINUE_LESSON"); a.put("label", "Back to the lesson"); a.put("courseId", lesson.path("courseId").asText()); a.put("lessonId", lesson.path("lessonId").asText()); }
        }
        else if (wantsPlan) {
            int budget = minutes == null ? 20 : Math.max(5, Math.min(240, minutes));
            JsonNode course = null; for (JsonNode c : courses) if (!"completed".equals(c.path("status").asText()) && c.has("nextLesson")) { course = c; break; }
            if (course == null) reply.append("Everything you're enrolled in is complete, so there's nothing to plan — explore a new course first.");
            else {
                ObjectNode plan = out.putObject("plan"); plan.put("minutes", budget); ArrayNode items = plan.putArray("items");
                JsonNode nl = course.path("nextLesson"); int m = Math.min(nl.path("minutes").asInt(5), budget);
                ObjectNode it = items.addObject(); it.put("kind", "quiz".equals(nl.path("type").asText()) ? "QUIZ" : "assignment".equals(nl.path("type").asText()) ? "PRACTICE" : "LESSON"); it.put("courseId", course.path("courseId").asText()); it.put("lessonId", nl.path("lessonId").asText()); it.put("title", nl.path("title").asText()); it.put("minutes", m);
                if (budget - m >= 3) { ObjectNode rv = items.addObject(); rv.put("kind", "REVIEW"); rv.put("courseId", course.path("courseId").asText()); rv.putNull("lessonId"); rv.put("title", "Review your notes from " + course.path("title").asText()); rv.put("minutes", Math.min(5, budget - m)); }
                reply.append("Here's a ").append(budget).append("-minute plan, ").append(name).append(":\n- ").append(nl.path("title").asText()).append(" (~").append(m).append(" min) — your next lesson in ").append(course.path("title").asText()).append(", which is ").append(course.path("pct").asInt()).append("% done");
                if (budget - m >= 3) reply.append("\n- Review your notes (").append(Math.min(5, budget - m)).append(" min)");
                ObjectNode a = actions.addObject(); a.put("type", "CONTINUE_LESSON"); a.put("label", "Start with " + nl.path("title").asText()); a.put("courseId", course.path("courseId").asText()); a.put("lessonId", nl.path("lessonId").asText());
            }
        }
        else if (question.contains("why")) {
            if (top == null) reply.append("There's no recommendation to explain yet — enrol in a course and I'll have something concrete for you.");
            else { reply.append("“").append(top.path("title").asText()).append("” is recommended because: ").append(top.path("reason").asText()); addRecAction(actions, top); }
        }
        else if (question.contains("skill")) {
            JsonNode sk = ctx.path("skills"); JsonNode weakest = null; for (JsonNode s : sk) if (weakest == null || s.path("gapPct").asInt() > weakest.path("gapPct").asInt()) weakest = s;
            if (weakest == null) reply.append("I don't have any skill data for you yet — skills appear once you enrol in courses that map to them.");
            else { reply.append("Your biggest gap is ").append(weakest.path("name").asText()).append(": ").append(weakest.path("level").asText()).append(" (").append(weakest.path("pct").asInt()).append("%) against a ").append(weakest.path("target").asText()).append(" target."); JsonNode rec = null; for (JsonNode r : recs) if (weakest.path("skillId").asText().equals(r.path("skillId").asText(null))) { rec = r; break; } if (rec != null) { reply.append(" ").append(rec.path("reason").asText()); addRecAction(actions, rec); } ObjectNode a = actions.addObject(); a.put("type", "VIEW_SKILL"); a.put("label", "See my skills"); a.put("skillId", weakest.path("skillId").asText()); }
        }
        else if (question.contains("behind") || question.contains("due") || question.contains("overdue")) {
            int n = 0; for (JsonNode c : courses) if (c.has("dueAt") && !"completed".equals(c.path("status").asText())) { n++; reply.append(n == 1 ? "Due dates on your plate:" : "").append("\n- ").append(c.path("title").asText()).append(" — due ").append(c.path("dueAt").asText().substring(0, 10)).append(", ").append(c.path("pct").asInt()).append("% done"); }
            if (n == 0) reply.append("Nothing is overdue and none of your courses has a due date, ").append(name).append(". "); if (top != null) { reply.append(n == 0 ? "The most useful next step is: " : "\nStart with: ").append(top.path("title").asText()).append(" — ").append(top.path("reason").asText()); addRecAction(actions, top); }
        }
        else if (question.contains("summar") || question.contains("progress") || question.contains("close to")) {
            int inProg = 0, done = 0; for (JsonNode c : courses) { if ("completed".equals(c.path("status").asText())) done++; else if (c.path("done").asInt() > 0) inProg++; }
            reply.append("Here's where you stand, ").append(name).append(": ").append(done).append(" course").append(done == 1 ? "" : "s").append(" completed, ").append(inProg).append(" in progress, streak ").append(ctx.path("learner").path("streakDays").asInt()).append(" day").append(ctx.path("learner").path("streakDays").asInt() == 1 ? "" : "s").append(".");
            JsonNode closest = null; for (JsonNode c : courses) if (!"completed".equals(c.path("status").asText()) && c.path("done").asInt() > 0 && (closest == null || c.path("pct").asInt() > closest.path("pct").asInt())) closest = c;
            if (closest != null) { reply.append(" Closest to finishing: ").append(closest.path("title").asText()).append(" at ").append(closest.path("pct").asInt()).append("% (").append(closest.path("minutesLeft").asInt()).append(" min left)."); ObjectNode a = actions.addObject(); a.put("type", "CONTINUE_LESSON"); a.put("label", "Continue " + closest.path("title").asText()); a.put("courseId", closest.path("courseId").asText()); a.put("lessonId", closest.path("nextLesson").path("lessonId").asText()); }
            JsonNode certs = ctx.path("certificates"); if (certs.isArray() && !certs.isEmpty()) reply.append(" Certificates: ").append(certs.size()).append(".");
        }
        else { // "what next" and anything else: lead with the top deterministic recommendation
            if (top == null) reply.append("You're not enrolled in anything yet, ").append(name).append(" — pick a course from Explore and I'll guide you from there.");
            else { reply.append("Next for you, ").append(name).append(": ").append(top.path("title").asText()).append(". ").append(top.path("reason").asText()); if (recs.size() > 1) reply.append("\nAfter that: ").append(recs.get(1).path("title").asText()).append("."); addRecAction(actions, top); }
        }
        out.put("reply", reply.toString());
        return new Completion(out.toString(), name(), model());
    }
    private static void addRecAction(ArrayNode actions, JsonNode rec) {
        ObjectNode a = actions.addObject();
        if (rec.hasNonNull("lessonId") && rec.hasNonNull("courseId")) { a.put("type", "CONTINUE_LESSON"); a.put("label", rec.path("title").asText()); a.put("courseId", rec.path("courseId").asText()); a.put("lessonId", rec.path("lessonId").asText()); }
        else if (rec.hasNonNull("courseId")) { a.put("type", "VIEW_COURSE"); a.put("label", "View " + rec.path("title").asText().replaceFirst("^(Explore|Improve .* with|Next on .*: )\\s*", "")); a.put("courseId", rec.path("courseId").asText()); }
        else if (rec.hasNonNull("skillId")) { a.put("type", "VIEW_SKILL"); a.put("label", "See my skills"); a.put("skillId", rec.path("skillId").asText()); }
        else if (rec.hasNonNull("pathId")) { a.put("type", "VIEW_JOURNEY"); a.put("label", "View journey"); a.put("pathId", rec.path("pathId").asText()); }
        else actions.remove(actions.size() - 1);
    }
    private static JsonNode block(String prompt, String marker) {
        int i = prompt.indexOf(marker); if (i < 0) return null;
        int start = prompt.indexOf('{', i); if (start < 0) return null;
        int depth = 0; for (int p = start; p < prompt.length(); p++) { char ch = prompt.charAt(p); if (ch == '{') depth++; else if (ch == '}') { depth--; if (depth == 0) { try { return Json.MAPPER.readTree(prompt.substring(start, p + 1)); } catch (Exception e) { return null; } } } }
        return null;
    }

    @Override public Completion generateQuiz(Prompt prompt) {
        if (prompt.user().contains(MALFORMED_TOKEN)) return new Completion("{\"questions\": [ {\"type\": \"mc\", \"prompt\": \"unterminated", name(), model());
        Fields f = Fields.parse(prompt.user());
        ObjectNode out = Json.MAPPER.createObjectNode();
        List<String> objectives = f.objectives.isEmpty() ? List.of(f.context.isBlank() ? "the key ideas of this lesson" : f.context) : f.objectives;
        out.set("questions", questions(objectives, f.count, f.quizDifficulty, f.questionType, f.sourceSnippet(0), f.sourceName(0), 0));
        return new Completion(out.toString(), name(), model());
    }

    private static ArrayNode questions(List<String> objectives, int count, String difficulty, String type, String src, String srcName, int seed) {
        String[] cycle = { "mc", "tf", "multi", "short" };
        ArrayNode qs = Json.MAPPER.createArrayNode();
        for (int i = 0; i < count; i++) {
            String objective = objectives.get(i % objectives.size());
            String t = "mixed".equals(type) ? cycle[(i + seed) % cycle.length] : type;
            ObjectNode q = qs.addObject();
            q.put("type", t); q.put("difficulty", difficulty); q.put("objective", objective);
            String focus = objective.toLowerCase();
            switch (t) {
                case "tf" -> { boolean ans = (i + seed) % 2 == 0; q.put("prompt", ans ? "True or false: " + capitalize(focus) + " is a goal of this course." : "True or false: " + capitalize(focus) + " can be skipped without affecting the outcome."); q.put("answer", ans); q.put("explanation", ans ? "It is one of the stated learning objectives." : "Skipping it undermines the objective: " + objective + "."); }
                case "multi" -> { ArrayNode o = q.putArray("options"); o.add("Apply " + focus + " consistently"); o.add("Review the result and adjust"); o.add("Ignore feedback from colleagues"); o.add("Wait for someone else to act"); ArrayNode ci = q.putArray("correctIndices"); ci.add(0); ci.add(1); q.put("prompt", "Which of the following help you " + focus + "? Select all that apply."); q.put("explanation", "Applying the approach and reviewing the result both support the objective; the other options work against it."); }
                case "short" -> { ArrayNode acc = q.putArray("acceptedAnswers"); for (String k : keywords(objective)) acc.add(k); q.put("prompt", "In your own words, describe how you would " + focus + "."); q.put("explanation", "A good answer mentions: " + String.join(", ", keywords(objective)) + "."); }
                default -> { ArrayNode o = q.putArray("options"); o.add("Focus on " + focus); o.add("Avoid discussing it with the team"); o.add("Postpone it until the end of the quarter"); o.add("Delegate it without any follow-up"); q.put("correctIndex", 0); q.put("prompt", "Which action best supports the objective “" + objective + "”?"); q.put("explanation", "The first option directly addresses the objective; the others delay or dilute it."); }
            }
            if (src != null) q.put("sourceRef", srcName); else q.putNull("sourceRef");
        }
        return qs;
    }

    private static void block(ArrayNode blocks, String type, String text, ArrayNode items, String sourceRef) {
        ObjectNode b = blocks.addObject(); b.put("type", type); b.put("text", text);
        if (items != null) b.set("items", items);
        if (sourceRef != null) b.put("sourceRef", sourceRef); else b.putNull("sourceRef");
    }
    private static List<String> keywords(String s) {
        List<String> out = new ArrayList<>();
        for (String w : s.replaceAll("[^A-Za-z0-9 ]", " ").split("\\s+")) if (w.length() > 4 && out.size() < 4 && !w.equalsIgnoreCase("their") && !w.equalsIgnoreCase("about")) out.add(w.toLowerCase());
        if (out.isEmpty()) out.add(s.trim().toLowerCase());
        return out;
    }
    private static String titleCase(String s) { String t = s.trim(); return t.isEmpty() ? t : Character.toUpperCase(t.charAt(0)) + t.substring(1); }
    private static String capitalize(String s) { return titleCase(s); }

    /** Parses the plain-text prompt built by Prompts.courseUser/quizUser back into fields (keeps the provider contract text-only). */
    private static final class Fields {
        String topic = "", audience = "general staff", difficulty = "Beginner", context = ""; int durationMinutes = 60, count = 5; String quizDifficulty = "medium", questionType = "mixed";
        List<String> objectives = new ArrayList<>(); List<String[]> sources = new ArrayList<>(); // [name, text]
        static Fields parse(String text) {
            Fields f = new Fields();
            String[] lines = text.split("\n");
            boolean inObjectives = false, inSources = false; String curName = null; StringBuilder cur = null;
            for (String raw : lines) {
                String line = raw.stripTrailing();
                if (inSources) {
                    Matcher m = Pattern.compile("^\\[source: (.+?)\\]$").matcher(line.trim());
                    if (m.matches()) { if (curName != null) f.sources.add(new String[]{ curName, cur.toString().trim() }); curName = m.group(1); cur = new StringBuilder(); }
                    else if (cur != null) cur.append(line).append('\n');
                    continue;
                }
                if (line.startsWith("Topic: ")) f.topic = line.substring(7).trim();
                else if (line.startsWith("Audience: ")) f.audience = line.substring(10).trim();
                else if (line.startsWith("Difficulty: ")) { String d = line.substring(12).trim(); f.difficulty = d; f.quizDifficulty = d.toLowerCase(); }
                else if (line.startsWith("Target duration (minutes): ")) f.durationMinutes = parseInt(line.substring(27), 60);
                else if (line.startsWith("Context: ")) f.context = line.substring(9).trim();
                else if (line.startsWith("Number of questions: ")) f.count = parseInt(line.substring(21), 5);
                else if (line.startsWith("Question type: ")) f.questionType = line.substring(15).trim().split(" ")[0];
                else if (line.startsWith("Learning objectives:")) inObjectives = true;
                else if (line.startsWith("Source material")) { inObjectives = false; inSources = true; }
                else if (inObjectives && line.startsWith("- ")) f.objectives.add(line.substring(2).trim());
            }
            if (curName != null) f.sources.add(new String[]{ curName, cur.toString().trim() });
            if (!List.of("easy", "medium", "hard").contains(f.quizDifficulty)) f.quizDifficulty = f.quizDifficulty.startsWith("adv") ? "hard" : f.quizDifficulty.startsWith("beg") ? "easy" : "medium";
            return f;
        }
        String sourceSnippet(int i) { if (sources.isEmpty()) return null; String t = sources.get(i % sources.size())[1]; if (t.isBlank()) return null; String[] sentences = t.split("(?<=[.!?])\\s+"); String s = sentences[Math.min(i, sentences.length - 1)].trim(); return s.length() > 240 ? s.substring(0, 237) + "…" : s; }
        String sourceName(int i) { return sources.isEmpty() ? null : sources.get(i % sources.size())[0]; }
        static int parseInt(String s, int d) { try { return Integer.parseInt(s.trim()); } catch (Exception e) { return d; } }
    }
}
