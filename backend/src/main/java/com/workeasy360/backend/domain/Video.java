package com.workeasy360.backend.domain;

import jakarta.persistence.*;
import lombok.*;
import java.time.Instant;

@Entity @Table(name = "videos")
@Getter @Setter @NoArgsConstructor @AllArgsConstructor @Builder
public class Video {
    @Id private String id;

    @Column(name = "owner_id", nullable = false, length = 40) private String ownerId;
    @Column(name = "course_id", length = 40) private String courseId;

    @Enumerated(EnumType.STRING) @Column(name = "source_type", nullable = false, length = 20)
    private Enums.VideoSourceType sourceType;

    @Column(name = "source_url", length = 1000) private String sourceUrl;
    @Column(name = "storage_key", length = 200) private String storageKey;
    @Column(name = "original_file_name", length = 300) private String originalFileName;
    @Column(name = "mime_type", length = 100) private String mimeType;
    @Column(name = "file_size") private Long fileSize;
    @Column(name = "thumbnail_key", length = 200) private String thumbnailKey;
    @Column(name = "duration_seconds") private Double durationSeconds;
    private Integer width;
    private Integer height;

    @Enumerated(EnumType.STRING) @Column(nullable = false, length = 20)
    private Enums.VideoStatus status;

    @Column(length = 300) private String title;
    @Column(length = 2000) private String description;

    @Enumerated(EnumType.STRING) @Column(nullable = false, length = 20)
    private Enums.VideoVisibility visibility;

    @Column(name = "captions_json") private String captionsJson;

    @Column(name = "created_at", nullable = false) private Instant createdAt;
    @Column(name = "updated_at", nullable = false) private Instant updatedAt;

    @PrePersist void prePersist() {
        if (id == null) id = Ids.next("v");
        createdAt = updatedAt = Instant.now();
        if (status == null) status = Enums.VideoStatus.READY;
        if (visibility == null) visibility = Enums.VideoVisibility.COURSE;
        if (sourceType == null) sourceType = Enums.VideoSourceType.NATIVE;
        if (durationSeconds == null) durationSeconds = 0d;
        if (title == null) title = "";
        if (description == null) description = "";
    }
    @PreUpdate void preUpdate() { updatedAt = Instant.now(); }
}
