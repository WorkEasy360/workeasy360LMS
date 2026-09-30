package com.workeasy360.backend.domain;

import jakarta.persistence.*;
import lombok.*;
import java.time.Instant;

@Entity @Table(name = "lesson_progress", uniqueConstraints = @UniqueConstraint(columnNames = {"user_id", "lesson_id"}))
@Getter @Setter @NoArgsConstructor @AllArgsConstructor @Builder
public class LessonProgress {
    @Id private String id;

    @Column(name = "user_id", nullable = false, length = 40) private String userId;
    @Column(name = "lesson_id", nullable = false, length = 40) private String lessonId;
    @Column(name = "course_id", nullable = false, length = 40) private String courseId;

    @Enumerated(EnumType.STRING) @Column(nullable = false, length = 20)
    private Enums.ProgressStatus status;

    @Column(nullable = false) private Integer percentage;
    @Column(name = "last_position") private Double lastPosition;
    @Column(name = "watch_percentage") private Double watchPercentage;
    @Column(name = "video_completed", nullable = false) private Boolean videoCompleted;
    private String note;

    @Column(name = "completed_at") private Instant completedAt;
    @Column(name = "updated_at", nullable = false) private Instant updatedAt;

    @PrePersist void prePersist() {
        if (id == null) id = Ids.next("p");
        updatedAt = Instant.now();
        if (status == null) status = Enums.ProgressStatus.NOT_STARTED;
        if (percentage == null) percentage = 0;
        if (lastPosition == null) lastPosition = 0d;
        if (watchPercentage == null) watchPercentage = 0d;
        if (videoCompleted == null) videoCompleted = false;
    }
    @PreUpdate void preUpdate() { updatedAt = Instant.now(); }
}
