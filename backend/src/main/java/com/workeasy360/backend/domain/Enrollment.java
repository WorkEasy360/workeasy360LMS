package com.workeasy360.backend.domain;

import jakarta.persistence.*;
import lombok.*;
import java.time.Instant;

@Entity @Table(name = "enrollments", uniqueConstraints = @UniqueConstraint(columnNames = {"user_id", "course_id"}))
@Getter @Setter @NoArgsConstructor @AllArgsConstructor @Builder
public class Enrollment {
    @Id private String id;

    @Column(name = "user_id", nullable = false, length = 40) private String userId;
    @Column(name = "course_id", nullable = false, length = 40) private String courseId;

    @Enumerated(EnumType.STRING) @Column(nullable = false, length = 20)
    private Enums.EnrollmentStatus status;

    @Column(name = "enrolled_at", nullable = false) private Instant enrolledAt;
    @Column(name = "started_at") private Instant startedAt;
    @Column(name = "completed_at") private Instant completedAt;
    @Column(name = "last_active_at") private Instant lastActiveAt;
    @Column(name = "last_lesson_id", length = 40) private String lastLessonId;
    @Column(name = "due_at") private Instant dueAt;

    @Column(name = "bookmarks_json") private String bookmarksJson;
    @Column(nullable = false, length = 20) private String source;   // FREE | PURCHASE | ASSIGNED
    @Column(name = "order_id", length = 40) private String orderId;

    @PrePersist void prePersist() { if (id == null) id = Ids.next("e"); if (enrolledAt == null) enrolledAt = Instant.now(); if (status == null) status = Enums.EnrollmentStatus.NOT_STARTED; if (source == null) source = "FREE"; }
}
