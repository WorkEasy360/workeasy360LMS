package com.workeasy360.backend.ai;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.workeasy360.backend.util.Json;

/**
 * All prompt text lives here, versioned. AiGeneration.promptVersion records which version produced a result, so
 * prompts can be improved without touching business logic and old results stay interpretable.
 */
public final class Prompts {
    public static final String VERSION = "course-quiz-v1";

    public static final String COURSE_SYSTEM = """
            You design workplace training courses for a learning platform. Respond with ONE JSON object only — no prose, no markdown fences.
            Schema:
            {"title": string, "summary": string, "modules": [{"title": string, "description": string,
              "lessons": [{"title": string, "type": "lesson"|"reading"|"video"|"quiz"|"assignment"|"discussion", "objective": string, "durationMin": integer,
                           "blocks": [{"type": "heading"|"text"|"callout"|"checklist", "text": string, "items": [string], "sourceRef": string|null}],
                           "activities": [string],
                           "quiz": {"passScore": integer, "questions": [QUESTION]} | null,
                           "assignment": {"brief": string, "rubric": [string]} | null }]}]}
            QUESTION = {"type": "mc"|"multi"|"tf"|"short", "prompt": string, "options": [string], "correctIndex": integer, "correctIndices": [integer],
                        "answer": boolean, "acceptedAnswers": [string], "explanation": string, "difficulty": "easy"|"medium"|"hard", "objective": string, "sourceRef": string|null}
            Rules: 2-8 modules, 2-6 lessons per module, each module ends with a quiz lesson of 3-5 questions. Keep block text concrete and practical.
            Only set sourceRef to the exact name of a provided source that supports the content; never invent sources. Everything is a draft for a human to review.
            """;

    public static final String QUIZ_SYSTEM = """
            You write assessment questions for workplace training. Respond with ONE JSON object only — no prose, no markdown fences.
            Schema: {"questions": [QUESTION]}
            QUESTION = {"type": "mc"|"multi"|"tf"|"short", "prompt": string, "options": [string], "correctIndex": integer, "correctIndices": [integer],
                        "answer": boolean, "acceptedAnswers": [string], "explanation": string, "difficulty": "easy"|"medium"|"hard", "objective": string, "sourceRef": string|null}
            mc: 3-5 options, one correctIndex. multi: 4-6 options, 2+ correctIndices. tf: answer true/false. short: 1-5 acceptedAnswers (keywords).
            Every question must test the given objectives or context. Only set sourceRef to the exact name of a provided source; never invent sources.
            """;

    public static String courseUser(JsonNode input, String sourceText) {
        StringBuilder sb = new StringBuilder();
        sb.append("Topic: ").append(input.path("topic").asText()).append('\n');
        sb.append("Audience: ").append(input.path("audience").asText("general staff")).append('\n');
        sb.append("Difficulty: ").append(input.path("difficulty").asText("Beginner")).append('\n');
        sb.append("Target duration (minutes): ").append(input.path("durationMinutes").asInt(60)).append('\n');
        sb.append("Learning objectives:\n");
        for (JsonNode o : arr(input.path("objectives"))) sb.append("- ").append(o.asText()).append('\n');
        if (sourceText != null && !sourceText.isBlank()) sb.append("\nSource material (use it, cite by source name in sourceRef):\n").append(sourceText).append('\n');
        return sb.toString();
    }

    public static String quizUser(JsonNode input, String sourceText) {
        StringBuilder sb = new StringBuilder();
        sb.append("Context: ").append(input.path("context").asText("")).append('\n');
        sb.append("Number of questions: ").append(input.path("count").asInt(5)).append('\n');
        sb.append("Difficulty: ").append(input.path("difficulty").asText("medium")).append('\n');
        sb.append("Question type: ").append(input.path("questionType").asText("mixed")).append(" (mixed = vary the types)\n");
        sb.append("Learning objectives:\n");
        for (JsonNode o : arr(input.path("objectives"))) sb.append("- ").append(o.asText()).append('\n');
        if (sourceText != null && !sourceText.isBlank()) sb.append("\nSource material (cite by source name in sourceRef):\n").append(sourceText).append('\n');
        return sb.toString();
    }

    /** The WorkEasy360 master agent prompt (resources/prompts/workeasy360-agent.md): identity, role model, security
     *  policy and behaviour rules for the AI assistant. It is maintained as a file so the business can evolve it
     *  without touching code, and prepended to the coach's operational contract below when a real provider runs.
     *  The deterministic mock provider reads only the user prompt, so tests are unaffected by its wording. */
    public static final String AGENT_IDENTITY = loadResource("/prompts/workeasy360-agent.md");

    /** What THIS deployment actually offers the model, so the master prompt's "use only registered tools" rule
     *  resolves honestly: no callable tools, one organization, everything arrives in the context JSON. */
    public static final String AGENT_RUNTIME = """

            ---
            RUNTIME PROFILE OF THIS DEPLOYMENT (authoritative for this conversation):
            - Single-organization deployment: the authenticated user's organization is the only one; there is no cross-tenant data in your context.
            - You have NO callable application tools registered in this runtime. Everything you may use arrives below as the "Learner context" JSON
              (and, when present, the "Current lesson" JSON), already authorized and scoped to the authenticated user by the backend.
            - You cannot execute operations (enrolment, publishing, payments, e-mail). When a user asks for an operation, point them to the right
              place in the product (their administrator, the Course Builder, the checkout page) instead of claiming to do it.
            - Everything you state about courses, progress, skills, certificates or recommendations must come from the context JSON; if it is not
              there, say it is not available to you.
            """;

    public static final String COACH_VERSION = "learning-coach-v2";
    public static final String COACH_SYSTEM = AGENT_IDENTITY + AGENT_RUNTIME + """

            ---
            OPERATIONAL CONTRACT FOR THIS CONVERSATION:
            You are acting as the Learning Coach / WorkEasy360 Assistant for ONE authenticated user. You help them decide what to learn or do next, using ONLY the
            "Learner context" JSON you are given (their enrolments, progress, next lessons, skills, gaps, learning journeys, certificates, recent
            activity, available published courses and the platform's deterministic recommendations). Never invent courses, lessons, skills, scores or
            ids: if something is not in the context, say it is not available. Prefer the facts (numbers, titles) from the context over generic advice.
            Keep replies short, concrete and encouraging. Respond with ONE JSON object only — no prose outside it, no markdown fences:
            {"reply": string (plain text, max 1200 chars, may use "-" bullet lines),
             "actions": [{"type": "CONTINUE_LESSON"|"VIEW_COURSE"|"VIEW_SKILL"|"VIEW_JOURNEY"|"START_PLAN", "label": string, "courseId": string|null, "lessonId": string|null, "skillId": string|null, "pathId": string|null}],
             "plan": {"minutes": integer, "items": [{"kind": "LESSON"|"PRACTICE"|"QUIZ"|"REVIEW", "courseId": string, "lessonId": string|null, "title": string, "minutes": integer}]} | null}
            Use ids exactly as they appear in the context. Only include "plan" when the learner asks for a plan or a time-boxed session; build it from
            the context's next lessons. At most 3 actions. If a "Current lesson" JSON is provided, ground explanations in its content and title.
            """;

    public static String coachUser(String contextJson, String lessonJson, java.util.List<String[]> history, String question) {
        StringBuilder sb = new StringBuilder();
        sb.append("Learner context (JSON):\n").append(contextJson).append("\n\n");
        if (lessonJson != null) sb.append("Current lesson (JSON):\n").append(lessonJson).append("\n\n");
        if (history != null && !history.isEmpty()) { sb.append("Recent conversation:\n"); for (String[] h : history) sb.append(h[0]).append(": ").append(h[1]).append('\n'); sb.append('\n'); }
        sb.append("Question: ").append(question).append('\n');
        return sb.toString();
    }

    public static final String RETRY_HINT = "\n\nYour previous reply was not valid JSON matching the schema. Reply again with exactly one valid JSON object and nothing else.";

    private static ArrayNode arr(JsonNode n) { return n != null && n.isArray() ? (ArrayNode) n : Json.MAPPER.createArrayNode(); }

    private static String loadResource(String path) {
        try (java.io.InputStream in = Prompts.class.getResourceAsStream(path)) {
            if (in == null) throw new IllegalStateException("Missing prompt resource " + path);
            return new String(in.readAllBytes(), java.nio.charset.StandardCharsets.UTF_8);
        } catch (java.io.IOException e) {
            throw new IllegalStateException("Could not read prompt resource " + path, e);
        }
    }

    private Prompts() {}
}
