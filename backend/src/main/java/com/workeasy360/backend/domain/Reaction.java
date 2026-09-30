package com.workeasy360.backend.domain;

import jakarta.persistence.*;
import lombok.*;

@Entity @Table(name = "reactions")
@Getter @Setter @NoArgsConstructor @AllArgsConstructor @Builder
public class Reaction {
    @Id private String id;

    @Column(name = "post_id", length = 40) private String postId;
    @Column(name = "comment_id", length = 40) private String commentId;
    @Column(name = "user_id", nullable = false, length = 40) private String userId;

    @Enumerated(EnumType.STRING) @Column(nullable = false, length = 20)
    private Enums.ReactionType type;

    @PrePersist void prePersist() { if (id == null) id = Ids.next("rx"); }
}
