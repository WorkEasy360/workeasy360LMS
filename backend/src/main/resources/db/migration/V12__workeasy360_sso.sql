-- Sign in with WorkEasy360 Accounts (docs/workeasy360-sso.md). Purely additive: no existing row changes, password
-- sign-in keeps working, and rolling back to an older jar needs no restore (Flyway ignores unknown migrations).
-- Plain DDL that both PostgreSQL (production) and H2 in PostgreSQL mode (the dev profile) accept.

-- Which WorkEasy360 organization (the ID token's organization_id) is which WorkEasyLMS organization. One to one:
-- a tenant is linked to at most one WorkEasy360 organization and the other way round. Created by the first
-- sign-in from that organization (linked_by 'first-sign-in') or by an operator command (linked_by 'operator').
-- Keyed by issuer as well, like the people below, so that an issuer move is one explicit, audited update.
create table workeasy360_organizations (
  issuer varchar(512) not null,
  workeasy360_org_id varchar(36) not null,
  org_id varchar(40) not null references organizations(id) on delete cascade,
  linked_by varchar(20) not null,
  linked_at timestamptz not null default now(),
  constraint pk_workeasy360_organizations primary key (issuer, workeasy360_org_id),
  constraint uq_workeasy360_organizations_org unique (org_id)
);

-- Which WorkEasy360 person (issuer + sub) is which WorkEasyLMS account. Identity is (issuer, sub), never the
-- e-mail address: e-mail and name are profile data as last reported, refreshed at each sign-in. One account per
-- person: user_id is unique too, so two identities can never share an account.
create table federated_identities (
  id varchar(40) primary key,
  issuer varchar(512) not null,
  subject varchar(255) not null,
  user_id varchar(40) not null references users(id) on delete cascade,
  email varchar(320),
  display_name varchar(200),
  created_at timestamptz not null default now(),
  last_sign_in_at timestamptz not null default now(),
  constraint uq_federated_identities_issuer_subject unique (issuer, subject),
  constraint uq_federated_identities_user unique (user_id)
);

-- Bearer tokens issued before this instant are refused. Set when an existing password account is linked to a
-- WorkEasy360 identity: its password is retired and the sessions it had are ended (completion design section 5).
alter table users add column tokens_valid_after timestamptz;

-- Back-channel logout (OpenID Connect Back-Channel Logout 1.0; WorkEasy360 ADR-069): the jti of every logout
-- token acted on, so that none is acted on twice. A row matters only while its token could still verify
-- (keep_until); the next accepted token deletes older rows in its own transaction. Nothing runs in the background.
create table received_logout_tokens (
  issuer varchar(512) not null,
  jti varchar(255) not null,
  received_at timestamptz not null,
  keep_until timestamptz not null,
  constraint pk_received_logout_tokens primary key (issuer, jti)
);
create index ix_received_logout_tokens_keep_until on received_logout_tokens (keep_until);

-- One row per WorkEasy360-signed-in session, on any instance. Sessions stay the servlet container's own (in the
-- memory of the instance that created them); every request made with one checks that its row still exists, and a
-- logout token deletes the rows it names. A missing row means "ended", so deleting a row can only ever sign
-- someone out. No session id is stored (it is a bearer credential): the session carries the row's id instead.
create table signed_in_sessions (
  id varchar(36) primary key,
  issuer varchar(512) not null,
  subject varchar(255) not null,
  sid varchar(255),
  created_at timestamptz not null,
  seen_at timestamptz not null
);
create index ix_signed_in_sessions_issuer_subject on signed_in_sessions (issuer, subject);
create index ix_signed_in_sessions_issuer_sid on signed_in_sessions (issuer, sid);
create index ix_signed_in_sessions_seen_at on signed_in_sessions (seen_at);

-- Sign-ins (sid) a logout token has ended, kept for ten minutes (longer than an ID token can be accepted), so a
-- sign-in for one that is still on its way back to the callback, on any instance, is refused.
create table ended_sign_ins (
  issuer varchar(512) not null,
  sid varchar(255) not null,
  ended_at timestamptz not null,
  keep_until timestamptz not null,
  constraint pk_ended_sign_ins primary key (issuer, sid)
);
create index ix_ended_sign_ins_keep_until on ended_sign_ins (keep_until);
