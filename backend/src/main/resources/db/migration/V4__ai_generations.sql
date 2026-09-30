-- AI generation records: every AI course/quiz generation request, its inputs (metadata + provenance), the
-- provider/model/prompt version that produced it, the validated result, and where it was applied.
-- Never stores API keys or provider credentials.
create table ai_generations (
  id varchar(40) primary key,
  user_id varchar(40) not null references users(id),
  type varchar(20) not null,                 -- COURSE | QUIZ
  status varchar(20) not null,               -- PENDING | COMPLETED | FAILED
  provider varchar(40) not null,             -- mock | openai | anthropic | ...
  model varchar(120),
  prompt_version varchar(40) not null,
  input_hash varchar(80) not null,           -- dedupe key: sha-256 of type + canonical input
  input_json text not null,                  -- request metadata (topic, audience, objectives, source metadata …)
  result_json text,                          -- validated, normalised generated structure
  sources_json text,                         -- provenance: [{kind, name, chars, hash, ref}]
  error varchar(2000),
  applied_course_id varchar(40),
  applied_lesson_id varchar(40),
  created_at timestamp not null default current_timestamp,
  completed_at timestamp
);
create index idx_ai_generations_user on ai_generations(user_id, created_at);
create index idx_ai_generations_hash on ai_generations(user_id, input_hash);
