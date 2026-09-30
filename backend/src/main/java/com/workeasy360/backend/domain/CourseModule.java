package com.workeasy360.backend.domain;

import jakarta.persistence.*;
import lombok.*;
import java.time.Instant;

@Entity @Table(name = "modules")
@Getter @Setter @NoArgsConstructor @AllArgsConstructor @Builder
public class CourseModule {
    @Id private String id;

    @Column(name = "course_id", nullable = false, length = 40) private String courseId;
    @Column(nullable = false, length = 200) private String title;
    @Column(nullable = false, length = 2000) private String description;
    @Column(nullable = false) private Integer position;

    @Column(name = "created_at", nullable = false) private Instant createdAt;
    @Column(name = "updated_at", nullable = false) private Instant updatedAt;

    @PrePersist void prePersist() { if (id == null) id = Ids.next("m"); createdAt = updatedAt = Instant.now(); if (title == null) title = ""; if (description == null) description = ""; if (position == null) position = 0; }
    @PreUpdate void preUpdate() { updatedAt = Instant.now(); }
}
