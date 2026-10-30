-- Multi-tenant foundation: organizations (tenants), the commercial plan catalogue, subscriptions, and an audit log.
-- Purely additive: every pre-existing row joins the default organization, so a deployed single-tenant installation
-- keeps working unchanged.

create table organizations (
  id varchar(40) primary key,
  name varchar(160) not null,
  slug varchar(80) not null unique,
  status varchar(20) not null default 'ACTIVE', -- ACTIVE | SUSPENDED
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- The organization every pre-tenancy row belongs to, and the platform owner's own organization (its staff never
-- appear in any customer directory).
insert into organizations (id, name, slug) values ('org-default', 'WorkEasy360', 'default');
insert into organizations (id, name, slug) values ('org-platform', 'WorkEasy360 Platform', 'platform');

-- Commercial plan catalogue. These rows are editable defaults, managed by the platform owner through the
-- platform API — prices and limits here are placeholders to configure before launch, not published prices.
create table plans (
  id varchar(40) primary key,
  name varchar(80) not null,
  description varchar(400),
  price_cents integer not null default 0,
  currency varchar(8) not null default 'INR',
  billing_period varchar(16) not null default 'MONTHLY', -- MONTHLY | ANNUAL
  max_users integer,          -- null = unlimited
  max_courses integer,        -- null = unlimited
  trial_days integer not null default 14,
  features_json text,
  status varchar(20) not null default 'ACTIVE', -- ACTIVE | RETIRED
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
insert into plans (id, name, description, price_cents, currency, max_users, max_courses, trial_days, position) values
  ('plan-starter',    'Starter',    'For small teams getting started with structured learning.',          0, 'INR',   25,   20, 14, 1),
  ('plan-growth',     'Growth',     'For growing organisations that train at scale.',                499900, 'INR',  200,  200, 14, 2),
  ('plan-enterprise', 'Enterprise', 'Unlimited scale, every feature, priority support.',            1999900, 'INR', null, null, 14, 3);

create table subscriptions (
  id varchar(40) primary key,
  org_id varchar(40) not null references organizations(id) on delete cascade,
  plan_id varchar(40) not null references plans(id),
  status varchar(20) not null default 'TRIAL', -- TRIAL | ACTIVE | PAST_DUE | SUSPENDED | CANCELLED | EXPIRED
  started_at timestamptz not null default now(),
  trial_ends_at timestamptz,
  renews_at timestamptz,
  cancelled_at timestamptz,
  order_ref varchar(80), -- the verified payment/order that activated it: makes provisioning idempotent
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index subscriptions_org on subscriptions(org_id);
create unique index subscriptions_order_ref on subscriptions(order_ref) where order_ref is not null;
insert into subscriptions (id, org_id, plan_id, status) values ('sub-default', 'org-default', 'plan-enterprise', 'ACTIVE');

create table audit_events (
  id varchar(40) primary key,
  at timestamptz not null default now(),
  actor_id varchar(40),
  org_id varchar(40),
  action varchar(80) not null,
  detail varchar(2000),
  outcome varchar(20) not null default 'OK'
);
create index audit_events_at on audit_events(at desc);
create index audit_events_org on audit_events(org_id);

-- Tenant ownership on every root entity. Leaf rows (enrollments, progress, attempts, submissions, certificates,
-- comments, reactions, notifications…) inherit their tenant through these roots and are always reached through them.
alter table users            add column org_id varchar(40) not null default 'org-default' references organizations(id);
alter table courses          add column org_id varchar(40) not null default 'org-default' references organizations(id);
alter table groups_          add column org_id varchar(40) not null default 'org-default' references organizations(id);
alter table posts            add column org_id varchar(40) not null default 'org-default' references organizations(id);
alter table skills           add column org_id varchar(40) not null default 'org-default' references organizations(id);
alter table skill_categories add column org_id varchar(40) not null default 'org-default' references organizations(id);
alter table learning_paths   add column org_id varchar(40) not null default 'org-default' references organizations(id);
alter table settings         add column org_id varchar(40) not null default 'org-default' references organizations(id);

create index users_org on users(org_id);
create index courses_org on courses(org_id);
create index groups_org on groups_(org_id);
create index posts_org on posts(org_id);
create index skills_org on skills(org_id);
create index skill_categories_org on skill_categories(org_id);
create index learning_paths_org on learning_paths(org_id);
create unique index settings_org on settings(org_id);
