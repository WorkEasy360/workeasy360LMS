-- Single-row org settings, mirroring the shape already used by the frontend's Admin > Settings screen.
create table settings (
  id varchar(20) primary key,
  org_name varchar(200) not null default 'Acme Corp',
  support_email varchar(200) not null default 'learning@acme.example',
  cert_expiry_default integer not null default 12,
  guides_enabled boolean not null default true,
  community_enabled boolean not null default true,
  brand_hue integer not null default 250,
  max_video_mb integer not null default 200,
  instructor_publish boolean not null default true
);
insert into settings (id) values ('singleton');
