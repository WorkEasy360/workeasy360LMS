package com.workeasy360.backend.service;

import com.workeasy360.backend.domain.Certificate;
import com.workeasy360.backend.domain.Course;
import com.workeasy360.backend.domain.Enums.CertificateStatus;
import com.workeasy360.backend.repo.Repos.CertificateRepo;
import com.workeasy360.backend.repo.Repos.CourseRepo;
import com.workeasy360.backend.web.ApiException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.security.SecureRandom;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Optional;

@Service
@Transactional
public class CertificateService {
    private static final SecureRandom RNG = new SecureRandom();
    private static final String ALPHA = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

    private final CertificateRepo certificates;
    private final CourseRepo courses;

    public CertificateService(CertificateRepo certificates, CourseRepo courses) { this.certificates = certificates; this.courses = courses; }

    public List<Certificate> forUser(String userId) { return certificates.findByUserId(userId); }
    public List<Certificate> all() { return certificates.findAll(); }

    public Certificate issueIfAbsent(String userId, String courseId) {
        Optional<Certificate> existing = certificates.findByUserIdAndCourseId(userId, courseId);
        if (existing.isPresent() && !existing.get().getRevoked() && status(existing.get()) != CertificateStatus.EXPIRED) return existing.get();

        Course course = courses.findById(courseId).orElseThrow(() -> ApiException.notFound("Course"));
        int year = java.time.Year.now().getValue();
        String code;
        do {
            StringBuilder sb = new StringBuilder("WE360-" + year + "-");
            for (int i = 0; i < 6; i++) sb.append(ALPHA.charAt(RNG.nextInt(ALPHA.length())));
            code = sb.toString();
        } while (certificates.findByCertificateNumberIgnoreCase(code).isPresent());

        Instant now = Instant.now();
        Certificate cert = Certificate.builder()
                .certificateNumber(code).userId(userId).courseId(courseId).issuedAt(now)
                .expiresAt(course.getCertExpiryMonths() != null && course.getCertExpiryMonths() > 0
                        ? now.plus((long) (course.getCertExpiryMonths() * 30.4), ChronoUnit.DAYS) : null)
                .status(CertificateStatus.VALID).revoked(false).build();
        return certificates.save(cert);
    }

    public CertificateStatus status(Certificate c) {
        if (c.getRevoked()) return CertificateStatus.REVOKED;
        if (c.getExpiresAt() != null && c.getExpiresAt().isBefore(Instant.now())) return CertificateStatus.EXPIRED;
        if (c.getExpiresAt() != null && c.getExpiresAt().isBefore(Instant.now().plus(60, ChronoUnit.DAYS))) return CertificateStatus.EXPIRING;
        return CertificateStatus.VALID;
    }

    public Optional<Certificate> verify(String number) { return certificates.findByCertificateNumberIgnoreCase(number.trim()); }

    public void revoke(String id) {
        Certificate c = certificates.findById(id).orElseThrow(() -> ApiException.notFound("Certificate"));
        c.setRevoked(true);
        certificates.save(c);
    }

    public Certificate renew(String id) {
        Certificate c = certificates.findById(id).orElseThrow(() -> ApiException.notFound("Certificate"));
        Course course = courses.findById(c.getCourseId()).orElseThrow(() -> ApiException.notFound("Course"));
        if (course.getCertExpiryMonths() == null || course.getCertExpiryMonths() <= 0) throw ApiException.badRequest("This certificate does not expire");
        Instant now = Instant.now();
        c.setIssuedAt(now);
        c.setExpiresAt(now.plus((long) (course.getCertExpiryMonths() * 30.4), ChronoUnit.DAYS));
        return certificates.save(c);
    }
}
