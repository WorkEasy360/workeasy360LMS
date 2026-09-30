package com.workeasy360.backend.dto;

import com.workeasy360.backend.domain.Certificate;

import java.time.Instant;

public class CertificateDtos {
    public record CertificateDto(String id, String certificateNumber, String userId, String courseId,
                                  Instant issuedAt, Instant expiresAt, String status) {
        public static CertificateDto of(Certificate c, String status) {
            return new CertificateDto(c.getId(), c.getCertificateNumber(), c.getUserId(), c.getCourseId(), c.getIssuedAt(), c.getExpiresAt(), status);
        }
    }
}
