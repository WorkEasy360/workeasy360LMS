package com.workeasy360.backend.domain;

import jakarta.persistence.*;
import lombok.*;
import java.time.Instant;

@Entity @Table(name = "comments")
@Getter @Setter @NoArgsConstructor @AllArgsConstructor @Builder
public class Comment {
    @Id private String id;

    @Column(name = "post_id", nullable = false, length = 40) private String postId;
    @Column(name = "author_id", nullable = false, length = 40) private String authorId;
    @Column(name = "parent_id", length = 40) private String parentId;
    @Column(nullable = false, length = 2000) private String body;
    @Column(name = "created_at", nullable = false) private Instant createdAt;

    @PrePersist void prePersist() { if (id == null) id = Ids.next("cm"); if (createdAt == null) createdAt = Instant.now(); }
}
