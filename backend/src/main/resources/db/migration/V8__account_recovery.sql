-- Self-service and admin-issued password resets. Only the SHA-256 of a token is stored: a database leak must not
-- hand out working reset links. Rows stay after use (used_at set) as a small audit trail.
create table password_resets (
  id varchar(40) primary key,
  user_id varchar(40) not null references users(id) on delete cascade,
  token_hash varchar(64) not null unique,
  expires_at timestamp not null,
  used_at timestamp,
  created_by varchar(40),
  created_at timestamp not null
);
create index idx_password_resets_user on password_resets(user_id);
