package com.workeasy360.backend.dto;

import com.workeasy360.backend.domain.Certificate;

import java.time.Instant;

public class CertificateDtos {
    /** A certificate as printed and publicly verified: names are included so it reads correctly on any device. */
    public record CertificateDto(String id, String certificateNumber, String userId, String courseId,
                                  Instant issuedAt, Instant expiresAt, String status,
                                  String recipientName, String courseTitle, String instructorName, String issuer) {
        public static CertificateDto of(Certificate c, String status, String recipientName, String courseTitle, String instructorName, String issuer) {
            return new CertificateDto(c.getId(), c.getCertificateNumber(), c.getUserId(), c.getCourseId(), c.getIssuedAt(), c.getExpiresAt(), status,
                    recipientName, courseTitle, instructorName, issuer);
        }
    }
}
