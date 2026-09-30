package com.workeasy360.backend.domain;

import jakarta.persistence.*;
import lombok.*;
import java.time.Instant;

@Entity @Table(name = "posts")
@Getter @Setter @NoArgsConstructor @AllArgsConstructor @Builder
public class Post {
    @Id private String id;

    @Column(name = "author_id", nullable = false, length = 40) private String authorId;

    @Enumerated(EnumType.STRING) @Column(nullable = false, length = 20)
    private Enums.PostKind kind;

    @Column(nullable = false, length = 300) private String title;
    @Column(length = 4000) private String body;

    @Column(name = "group_id", length = 40) private String groupId;
    @Column(name = "course_id", length = 40) private String courseId;
    @Column(name = "lesson_id", length = 40) private String lessonId;

    @Column(nullable = false) private Boolean pinned;
    @Column(name = "created_at", nullable = false) private Instant createdAt;

    @PrePersist void prePersist() { if (id == null) id = Ids.next("post"); if (createdAt == null) createdAt = Instant.now(); if (kind == null) kind = Enums.PostKind.DISCUSSION; if (pinned == null) pinned = false; if (body == null) body = ""; }
}
