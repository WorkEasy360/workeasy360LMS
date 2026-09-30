package com.workeasy360.backend.domain;

import jakarta.persistence.*;
import lombok.*;
import java.time.Instant;

@Entity @Table(name = "lessons")
@Getter @Setter @NoArgsConstructor @AllArgsConstructor @Builder
public class Lesson {
    @Id private String id;

    @Column(name = "module_id", nullable = false, length = 40) private String moduleId;
    @Column(nullable = false, length = 200) private String title;
    @Column(nullable = false, length = 2000) private String description;

    @Enumerated(EnumType.STRING) @Column(name = "lesson_type", nullable = false, length = 30)
    private Enums.LessonType lessonType;

    @Column(nullable = false) private Integer position;
    @Column(name = "duration_min", nullable = false) private Integer durationMin;
    @Column(nullable = false, length = 20) private String status;

    @Column(name = "content_json") private String contentJson;       // content blocks array
    @Column(name = "quiz_json") private String quizJson;             // {passScore, questions:[...]}
    @Column(name = "assignment_json") private String assignmentJson; // {brief, rubric:[...]}

    @Enumerated(EnumType.STRING) @Column(name = "completion_rule", nullable = false, length = 20)
    private Enums.CompletionRule completionRule;

    @Column(name = "created_at", nullable = false) private Instant createdAt;
    @Column(name = "updated_at", nullable = false) private Instant updatedAt;

    @PrePersist void prePersist() {
        if (id == null) id = Ids.next("l");
        createdAt = updatedAt = Instant.now();
        if (lessonType == null) lessonType = Enums.LessonType.LESSON;
        if (position == null) position = 0;
        if (durationMin == null) durationMin = 5;
        if (status == null) status = "DRAFT";
        if (completionRule == null) completionRule = Enums.CompletionRule.MANUAL;
        if (title == null) title = "";
        if (description == null) description = "";
    }
    @PreUpdate void preUpdate() { updatedAt = Instant.now(); }
}
