-- Skills engine + persisted learning paths.
create table skill_categories (
  id varchar(40) primary key,
  name varchar(120) not null,
  description varchar(500),
  position integer not null default 0
);

create table skills (
  id varchar(40) primary key,
  name varchar(120) not null,
  description varchar(1000),
  category_id varchar(40) references skill_categories(id),
  icon varchar(40) default 'target',
  levels_json text,            -- [{level:1,label:"Novice"},...] proficiency definition
  active boolean not null default true,
  created_at timestamp not null default current_timestamp,
  updated_at timestamp not null default current_timestamp
);

create table course_skills (
  id varchar(40) primary key,
  course_id varchar(40) not null references courses(id) on delete cascade,
  skill_id varchar(40) not null references skills(id) on delete cascade,
  target_level integer not null default 3,   -- 1 Novice · 2 Developing · 3 Proficient · 4 Advanced
  weight integer not null default 30,        -- progress points awarded when the course is completed
  unique(course_id, skill_id)
);
create index idx_course_skills_course on course_skills(course_id);

create table lesson_skills (
  id varchar(40) primary key,
  lesson_id varchar(40) not null references lessons(id) on delete cascade,
  skill_id varchar(40) not null references skills(id) on delete cascade,
  contribution_percentage integer not null default 10,
  unique(lesson_id, skill_id)
);
create index idx_lesson_skills_lesson on lesson_skills(lesson_id);

create table user_skills (
  id varchar(40) primary key,
  user_id varchar(40) not null references users(id) on delete cascade,
  skill_id varchar(40) not null references skills(id) on delete cascade,
  current_level integer not null default 1,
  progress_percentage integer not null default 0,
  evidence_json text,          -- [{source, refId, label, points, at}]
  updated_at timestamp not null default current_timestamp,
  unique(user_id, skill_id)
);
create index idx_user_skills_user on user_skills(user_id);

create table skill_assessments (
  id varchar(40) primary key,
  user_id varchar(40) not null references users(id) on delete cascade,
  skill_id varchar(40) not null references skills(id) on delete cascade,
  lesson_id varchar(40),
  course_id varchar(40),
  kind varchar(20) not null,   -- QUIZ | ASSIGNMENT
  score integer,
  passed boolean not null default false,
  at timestamp not null default current_timestamp
);
create index idx_skill_assessments_user on skill_assessments(user_id, skill_id);

create table learning_paths (
  id varchar(40) primary key,
  title varchar(200) not null,
  description varchar(1000),
  active boolean not null default true,
  created_at timestamp not null default current_timestamp
);

create table learning_path_nodes (
  id varchar(40) primary key,
  path_id varchar(40) not null references learning_paths(id) on delete cascade,
  node_key varchar(40) not null,        -- stable key within the path, used by `requires`
  node_type varchar(20) not null,       -- COURSE | MILESTONE
  course_id varchar(40) references courses(id) on delete cascade,
  title varchar(200),
  description varchar(500),
  requires_json text,                   -- ["n1","n2"] node_keys that must be completed first
  position integer not null default 0
);
create index idx_lp_nodes_path on learning_path_nodes(path_id);
