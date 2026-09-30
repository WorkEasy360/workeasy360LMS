package com.workeasy360.backend.domain;

import jakarta.persistence.*;
import lombok.*;
import java.time.Instant;

@Entity @Table(name = "quiz_attempts")
@Getter @Setter @NoArgsConstructor @AllArgsConstructor @Builder
public class QuizAttempt {
    @Id private String id;

    @Column(name = "user_id", nullable = false, length = 40) private String userId;
    @Column(name = "lesson_id", nullable = false, length = 40) private String lessonId;
    @Column(name = "course_id", nullable = false, length = 40) private String courseId;

    @Column(name = "responses_json") private String responsesJson;

    private Integer score;
    @Column(nullable = false) private Boolean passed;
    @Column(name = "attempt_number", nullable = false) private Integer attemptNumber;

    @Column(name = "started_at", nullable = false) private Instant startedAt;
    @Column(name = "submitted_at") private Instant submittedAt;

    @PrePersist void prePersist() { if (id == null) id = Ids.next("qa"); if (startedAt == null) startedAt = Instant.now(); if (passed == null) passed = false; if (attemptNumber == null) attemptNumber = 1; }
}
