package com.workeasy360.backend.service;

import com.workeasy360.backend.domain.Certificate;
import com.workeasy360.backend.domain.Course;
import com.workeasy360.backend.domain.Enums.CertificateStatus;
import com.workeasy360.backend.domain.Settings;
import com.workeasy360.backend.domain.User;
import com.workeasy360.backend.dto.CertificateDtos.CertificateDto;
import com.workeasy360.backend.repo.Repos.CertificateRepo;
import com.workeasy360.backend.repo.Repos.CourseRepo;
import com.workeasy360.backend.repo.Repos.UserRepo;
import com.workeasy360.backend.repo.SettingsRepo;
import com.workeasy360.backend.web.ApiException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.security.SecureRandom;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.function.Function;
import java.util.stream.Collectors;

@Service
@Transactional
public class CertificateService {
    private static final SecureRandom RNG = new SecureRandom();
    private static final String ALPHA = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

    private final CertificateRepo certificates;
    private final CourseRepo courses;
    private final UserRepo users;
    private final SettingsRepo settings;

    public CertificateService(CertificateRepo certificates, CourseRepo courses, UserRepo users, SettingsRepo settings) {
        this.certificates = certificates; this.courses = courses; this.users = users; this.settings = settings;
    }

    public List<Certificate> forUser(String userId) { return certificates.findByUserId(userId); }
    public List<Certificate> all() { return certificates.findAll(); }

    /** Certificates with recipient, course, instructor and issuing organisation resolved in bulk (one query per table). */
    @Transactional(readOnly = true)
    public List<CertificateDto> views(List<Certificate> list) {
        Map<String, Course> courseById = courses.findAllById(list.stream().map(Certificate::getCourseId).distinct().toList()).stream()
                .collect(Collectors.toMap(Course::getId, Function.identity()));
        Set<String> userIds = new HashSet<>();
        list.forEach(c -> userIds.add(c.getUserId()));
        courseById.values().forEach(c -> userIds.add(c.getInstructorId()));
        Map<String, String> names = users.findAllById(userIds).stream().collect(Collectors.toMap(User::getId, User::getName));
        String issuer = settings.findById("singleton").map(Settings::getOrgName).orElse(null);
        return list.stream().map(c -> {
            Course course = courseById.get(c.getCourseId());
            return CertificateDto.of(c, status(c).name(), names.get(c.getUserId()), course == null ? null : course.getTitle(),
                    course == null ? null : names.get(course.getInstructorId()), issuer);
        }).toList();
    }

    public CertificateDto view(Certificate c) { return views(List.of(c)).get(0); }

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
