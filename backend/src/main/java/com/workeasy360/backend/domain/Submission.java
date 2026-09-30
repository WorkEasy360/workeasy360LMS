package com.workeasy360.backend.domain;

import jakarta.persistence.*;
import lombok.*;
import java.time.Instant;

@Entity @Table(name = "submissions")
@Getter @Setter @NoArgsConstructor @AllArgsConstructor @Builder
public class Submission {
    @Id private String id;

    @Column(name = "user_id", nullable = false, length = 40) private String userId;
    @Column(name = "lesson_id", nullable = false, length = 40) private String lessonId;
    @Column(name = "course_id", nullable = false, length = 40) private String courseId;

    private String body;

    @Enumerated(EnumType.STRING) @Column(nullable = false, length = 20)
    private Enums.SubmissionStatus status;

    private String feedback;

    @Column(name = "submitted_at", nullable = false) private Instant submittedAt;
    @Column(name = "reviewed_at") private Instant reviewedAt;
    @Column(name = "reviewed_by", length = 40) private String reviewedBy;

    @PrePersist void prePersist() { if (id == null) id = Ids.next("sub"); if (submittedAt == null) submittedAt = Instant.now(); if (status == null) status = Enums.SubmissionStatus.SUBMITTED; }
}
