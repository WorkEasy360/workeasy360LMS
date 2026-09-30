-- Learning Coach + personalised recommendations. Every table references existing entities (users, courses,
-- lessons, skills, learning_paths) by id; nothing about progress, skills or journeys is duplicated here.
create table recommendations (
  id varchar(40) primary key,
  user_id varchar(40) not null references users(id),
  type varchar(30) not null,                 -- CONTINUE_COURSE | COMPLETE_LESSON | SKILL_GAP | REVIEW | PRACTICE | ASSESSMENT | LEARNING_PATH | NEW_COURSE | CERTIFICATION
  ref_key varchar(160) not null,             -- type-scoped stable key of the target (course/lesson/skill/path)
  course_id varchar(40),
  lesson_id varchar(40),
  skill_id varchar(40),
  path_id varchar(40),
  title varchar(300) not null,
  reason varchar(1000) not null,             -- human-readable, built from the learner's actual data
  facts_json text,                           -- ["4 of 6 lessons complete", ...]
  signals_json text,                         -- internal ranking signals (never shown as a score)
  priority integer not null default 0,
  minutes integer,
  status varchar(20) not null default 'ACTIVE',   -- ACTIVE | DISMISSED | COMPLETED
  feedback varchar(20),                      -- HELPFUL | NOT_RELEVANT
  created_at timestamp not null default current_timestamp,
  updated_at timestamp not null default current_timestamp,
  dismissed_at timestamp,
  unique (user_id, ref_key)
);
create index idx_recommendations_user on recommendations(user_id, status);

create table recommendation_feedback (
  id varchar(40) primary key,
  user_id varchar(40) not null references users(id),
  recommendation_id varchar(40) not null references recommendations(id) on delete cascade,
  ref_key varchar(160) not null,
  value varchar(20) not null,                -- HELPFUL | NOT_RELEVANT | DISMISSED
  at timestamp not null default current_timestamp
);
create index idx_rec_feedback_user on recommendation_feedback(user_id, ref_key);

create table coach_conversations (
  id varchar(40) primary key,
  user_id varchar(40) not null references users(id),
  title varchar(200),
  lesson_id varchar(40),                     -- conversation opened from a lesson (context), if any
  created_at timestamp not null default current_timestamp,
  updated_at timestamp not null default current_timestamp
);
create index idx_coach_conversations_user on coach_conversations(user_id, updated_at);

create table coach_messages (
  id varchar(40) primary key,
  conversation_id varchar(40) not null references coach_conversations(id) on delete cascade,
  role varchar(10) not null,                 -- USER | COACH
  content text not null,
  actions_json text,                         -- validated structured actions (ids verified against the learner's context)
  generation_id varchar(40),                 -- ai_generations audit row that produced a COACH message
  at timestamp not null default current_timestamp
);
create index idx_coach_messages_conversation on coach_messages(conversation_id, at);

create table learning_plans (
  id varchar(40) primary key,
  user_id varchar(40) not null references users(id),
  title varchar(200) not null,
  minutes integer not null,
  status varchar(20) not null default 'DRAFT',    -- DRAFT | ACTIVE | COMPLETED | DISMISSED
  source varchar(20) not null default 'MANUAL',   -- MANUAL | COACH
  course_id varchar(40),
  created_at timestamp not null default current_timestamp,
  started_at timestamp,
  completed_at timestamp
);
create index idx_learning_plans_user on learning_plans(user_id, status);

create table learning_plan_items (
  id varchar(40) primary key,
  plan_id varchar(40) not null references learning_plans(id) on delete cascade,
  position integer not null,
  kind varchar(20) not null,                 -- LESSON | PRACTICE | QUIZ | REVIEW
  course_id varchar(40),
  lesson_id varchar(40),
  title varchar(300) not null,
  minutes integer not null,
  done boolean not null default false        -- REVIEW items are marked by the learner; lesson-backed items follow lesson_progress
);
create index idx_learning_plan_items_plan on learning_plan_items(plan_id, position);
