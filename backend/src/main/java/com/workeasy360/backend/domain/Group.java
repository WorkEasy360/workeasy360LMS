package com.workeasy360.backend.domain;

import jakarta.persistence.*;
import lombok.*;

@Entity @Table(name = "groups_")
@Getter @Setter @NoArgsConstructor @AllArgsConstructor @Builder
public class Group {
    @Id private String id;
    @Column(nullable = false, length = 160) private String name;
    @Column(length = 500) private String description;
    private Integer hue;
    @Column(name = "org_id", nullable = false, length = 40) private String orgId;

    @PrePersist void prePersist() { if (id == null) id = Ids.next("g"); if (hue == null) hue = 220; if (orgId == null) orgId = Organization.DEFAULT; }
}
