package com.workeasy360.backend.domain;

// All enums are STRING-mapped in the DB (see V1__init.sql) so values stay readable and portable.
public class Enums {
    /** PLATFORM is WorkEasy360's own staff (the product owner): platform-wide oversight, never a member of any customer organization. */
    public enum Role { ADMIN, INSTRUCTOR, LEARNER, PLATFORM }

    public enum CourseStatus { DRAFT, IN_REVIEW, PUBLISHED, ARCHIVED }
    public enum CourseVisibility { CATALOG, ASSIGNED }

    public enum LessonType { LESSON, VIDEO, READING, QUIZ, ASSIGNMENT, DISCUSSION }
    public enum LessonStatus { DRAFT, READY }
    public enum CompletionRule { MANUAL, WATCH_90, WATCH_100 }

    public enum VideoSourceType { NATIVE, YOUTUBE, VIMEO, EXTERNAL }
    public enum VideoStatus { UPLOADING, PROCESSING, READY, FAILED }
    public enum VideoVisibility { COURSE, ORGANISATION }

    public enum EnrollmentStatus { NOT_STARTED, IN_PROGRESS, COMPLETED }
    public enum ProgressStatus { NOT_STARTED, IN_PROGRESS, COMPLETED }

    public enum SubmissionStatus { DRAFT, SUBMITTED, UNDER_REVIEW, REVIEWED }
    public enum CertificateStatus { VALID, EXPIRING, EXPIRED, REVOKED }

    public enum PostKind { DISCUSSION, QUESTION, POST }
    public enum ReactionType { LIKE, INSIGHT, CELEBRATE }

    public enum GuideStatus { IN_PROGRESS, COMPLETED }
}
