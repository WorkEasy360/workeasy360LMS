package com.workeasy360.backend.domain;

import jakarta.persistence.*;
import lombok.*;
import java.io.Serializable;

@Entity @Table(name = "group_members")
@IdClass(GroupMember.Key.class)
@Getter @Setter @NoArgsConstructor @AllArgsConstructor @Builder
public class GroupMember {
    @Id @Column(name = "group_id", length = 40) private String groupId;
    @Id @Column(name = "user_id", length = 40) private String userId;

    @Getter @Setter @NoArgsConstructor @AllArgsConstructor
    public static class Key implements Serializable {
        private String groupId;
        private String userId;
    }
}
