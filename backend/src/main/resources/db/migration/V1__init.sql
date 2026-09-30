-- Core schema. IDs are app-generated string UUIDs (portable across H2-Postgres-mode and real PostgreSQL).
-- JSON-shaped, flexible data (lesson content blocks, quiz payloads, video captions) is stored as TEXT and
-- (de)serialized in the service layer — the same flexible shape the frontend already authors, now persisted
-- server-side instead of hardcoded/localStorage, without forcing a relational table per block type.

create table users (
  id varchar(40) primary key,
  name varchar(160) not null,
  email varchar(200) not null unique,
  password_hash varchar(200) not null,
  role varchar(20) not null,               -- ADMIN | INSTRUCTOR | LEARNER
  title varchar(160),
  dept varchar(120),
  hue integer default 220,
  status varchar(20) not null default 'ACTIVE',
  streak integer not null default 0,
  created_at timestamp not null default current_timestamp,
  updated_at timestamp not null default current_timestamp
);

create table courses (
  id varchar(40) primary key,
  title varchar(200) not null default '',
  description varchar(2000) not null default '',
  cover_hue integer default 220,
  cover_icon varchar(40) default 'book',
  category varchar(80) not null default 'Sales',
  level varchar(40) not null default 'Beginner',
  status varchar(20) not null default 'DRAFT',      -- DRAFT | IN_REVIEW | PUBLISHED | ARCHIVED
  visibility varchar(20) not null default 'CATALOG', -- CATALOG | ASSIGNED
  instructor_id varchar(40) not null references users(id),
  sequential boolean not null default true,
  cert_expiry_months integer not null default 0,
  skills_json text,
  previous_status varchar(20),
  created_at timestamp not null default current_timestamp,
  updated_at timestamp not null default current_timestamp,
  published_at timestamp
);
create index idx_courses_instructor on courses(instructor_id);
create index idx_courses_status on courses(status);

create table modules (
  id varchar(40) primary key,
  course_id varchar(40) not null references courses(id) on delete cascade,
  title varchar(200) not null default '',
  description varchar(2000) not null default '',
  position integer not null default 0,
  created_at timestamp not null default current_timestamp,
  updated_at timestamp not null default current_timestamp
);
create index idx_modules_course on modules(course_id);

create table lessons (
  id varchar(40) primary key,
  module_id varchar(40) not null references modules(id) on delete cascade,
  title varchar(200) not null default '',
  description varchar(2000) not null default '',
  lesson_type varchar(30) not null default 'LESSON', -- LESSON|VIDEO|READING|QUIZ|ASSIGNMENT|DISCUSSION
  position integer not null default 0,
  duration_min integer not null default 5,
  status varchar(20) not null default 'DRAFT',
  content_json text,          -- content blocks array, same shape the Course Builder already authors
  quiz_json text,             -- {passScore, questions:[...]}
  assignment_json text,       -- {brief, rubric:[...]}
  completion_rule varchar(20) not null default 'MANUAL', -- MANUAL|WATCH_90|WATCH_100
  created_at timestamp not null default current_timestamp,
  updated_at timestamp not null default current_timestamp
);
create index idx_lessons_module on lessons(module_id);

create table videos (
  id varchar(40) primary key,
  owner_id varchar(40) not null references users(id),
  course_id varchar(40) references courses(id) on delete cascade,
  source_type varchar(20) not null default 'NATIVE', -- NATIVE|YOUTUBE|VIMEO|EXTERNAL
  source_url varchar(1000),
  storage_key varchar(200),
  original_file_name varchar(300),
  mime_type varchar(100),
  file_size bigint,
  thumbnail_key varchar(200),
  duration_seconds double precision default 0,
  width integer,
  height integer,
  status varchar(20) not null default 'READY', -- UPLOADING|PROCESSING|READY|FAILED
  title varchar(300) default '',
  description varchar(2000) default '',
  visibility varchar(20) not null default 'COURSE',
  captions_json text,
  created_at timestamp not null default current_timestamp,
  updated_at timestamp not null default current_timestamp
);
create index idx_videos_owner on videos(owner_id);

create table enrollments (
  id varchar(40) primary key,
  user_id varchar(40) not null references users(id),
  course_id varchar(40) not null references courses(id) on delete cascade,
  status varchar(20) not null default 'IN_PROGRESS', -- NOT_STARTED|IN_PROGRESS|COMPLETED
  enrolled_at timestamp not null default current_timestamp,
  started_at timestamp,
  completed_at timestamp,
  last_active_at timestamp,
  last_lesson_id varchar(40),
  due_at timestamp,
  bookmarks_json text,
  unique(user_id, course_id)
);
create index idx_enrollments_user on enrollments(user_id);
create index idx_enrollments_course on enrollments(course_id);

create table lesson_progress (
  id varchar(40) primary key,
  user_id varchar(40) not null references users(id),
  lesson_id varchar(40) not null references lessons(id) on delete cascade,
  course_id varchar(40) not null references courses(id) on delete cascade,
  status varchar(20) not null default 'NOT_STARTED', -- NOT_STARTED|IN_PROGRESS|COMPLETED
  percentage integer not null default 0,
  last_position double precision default 0,
  watch_percentage double precision default 0,
  video_completed boolean not null default false,
  note text,
  completed_at timestamp,
  updated_at timestamp not null default current_timestamp,
  unique(user_id, lesson_id)
);
create index idx_progress_user_course on lesson_progress(user_id, course_id);

create table quiz_attempts (
  id varchar(40) primary key,
  user_id varchar(40) not null references users(id),
  lesson_id varchar(40) not null references lessons(id) on delete cascade,
  course_id varchar(40) not null references courses(id) on delete cascade,
  responses_json text,      -- {questionId: answer}
  score integer,
  passed boolean not null default false,
  attempt_number integer not null default 1,
  started_at timestamp not null default current_timestamp,
  submitted_at timestamp
);
create index idx_quiz_attempts_user_lesson on quiz_attempts(user_id, lesson_id);

create table submissions (
  id varchar(40) primary key,
  user_id varchar(40) not null references users(id),
  lesson_id varchar(40) not null references lessons(id) on delete cascade,
  course_id varchar(40) not null references courses(id) on delete cascade,
  body text,
  status varchar(20) not null default 'SUBMITTED', -- DRAFT|SUBMITTED|UNDER_REVIEW|REVIEWED
  feedback text,
  submitted_at timestamp not null default current_timestamp,
  reviewed_at timestamp,
  reviewed_by varchar(40) references users(id)
);
create index idx_submissions_user_lesson on submissions(user_id, lesson_id);

create table certificates (
  id varchar(40) primary key,
  certificate_number varchar(60) not null unique,
  user_id varchar(40) not null references users(id),
  course_id varchar(40) not null references courses(id),
  issued_at timestamp not null default current_timestamp,
  expires_at timestamp,
  status varchar(20) not null default 'VALID', -- VALID|EXPIRING|EXPIRED|REVOKED
  revoked boolean not null default false
);
create index idx_certificates_user on certificates(user_id);

create table groups_ (
  id varchar(40) primary key,
  name varchar(160) not null,
  description varchar(500),
  hue integer default 220
);
create table group_members (
  group_id varchar(40) not null references groups_(id) on delete cascade,
  user_id varchar(40) not null references users(id) on delete cascade,
  primary key (group_id, user_id)
);

create table posts (
  id varchar(40) primary key,
  author_id varchar(40) not null references users(id),
  kind varchar(20) not null default 'DISCUSSION', -- DISCUSSION|QUESTION|POST
  title varchar(300) not null default '',
  body varchar(4000) default '',
  group_id varchar(40) references groups_(id),
  course_id varchar(40) references courses(id),
  lesson_id varchar(40) references lessons(id),
  pinned boolean not null default false,
  created_at timestamp not null default current_timestamp
);
create index idx_posts_group on posts(group_id);
create index idx_posts_course_lesson on posts(course_id, lesson_id);

create table comments (
  id varchar(40) primary key,
  post_id varchar(40) not null references posts(id) on delete cascade,
  author_id varchar(40) not null references users(id),
  parent_id varchar(40) references comments(id) on delete cascade,
  body varchar(2000) not null default '',
  created_at timestamp not null default current_timestamp
);
create index idx_comments_post on comments(post_id);

create table reactions (
  id varchar(40) primary key,
  post_id varchar(40) references posts(id) on delete cascade,
  comment_id varchar(40) references comments(id) on delete cascade,
  user_id varchar(40) not null references users(id),
  type varchar(20) not null -- LIKE|INSIGHT|CELEBRATE
);
create index idx_reactions_lookup on reactions(post_id, comment_id, user_id, type);
-- Uniqueness (one reaction per user/type/target) is enforced in ReactionService (check-then-write), since
-- post_id/comment_id are nullable alternatives and a portable partial/expression unique index isn't worth
-- the H2-vs-PostgreSQL syntax divergence here.

create table guide_progress (
  id varchar(40) primary key,
  user_id varchar(40) not null references users(id),
  guide_id varchar(80) not null,
  status varchar(20) not null default 'IN_PROGRESS', -- IN_PROGRESS|COMPLETED
  step_index integer not null default 0,
  completed_steps_json text,
  started_at timestamp not null default current_timestamp,
  updated_at timestamp not null default current_timestamp,
  completed_at timestamp,
  unique(user_id, guide_id)
);

create table guide_analytics (
  id varchar(40) primary key,
  user_id varchar(40) not null references users(id),
  guide_id varchar(80) not null,
  event varchar(40) not null,
  step integer,
  duration_ms bigint,
  at timestamp not null default current_timestamp
);
create index idx_guide_analytics_guide on guide_analytics(guide_id);

create table notifications (
  id varchar(40) primary key,
  user_id varchar(40) not null references users(id),
  kind varchar(30) not null,
  title varchar(300) not null,
  body varchar(1000),
  href varchar(300),
  read boolean not null default false,
  at timestamp not null default current_timestamp
);
create index idx_notifications_user on notifications(user_id);
