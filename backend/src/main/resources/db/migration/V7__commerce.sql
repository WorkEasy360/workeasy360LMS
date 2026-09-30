-- Course pricing, orders/payments and entitlement source. Additive only.
alter table courses add column price_cents integer not null default 0;   -- 0 = free
alter table courses add column currency varchar(3) not null default 'INR';

alter table enrollments add column source varchar(20) not null default 'FREE';   -- FREE | PURCHASE | ASSIGNED
alter table enrollments add column order_id varchar(40);

create table orders (
  id varchar(40) primary key,
  user_id varchar(40) not null references users(id) on delete cascade,
  course_id varchar(40) not null references courses(id) on delete cascade,
  amount_cents integer not null,
  currency varchar(3) not null,
  status varchar(20) not null,               -- PENDING | SUCCESS | FAILED | CANCELLED | REFUNDED
  provider varchar(30) not null,
  provider_ref varchar(120),
  created_at timestamp not null default current_timestamp,
  updated_at timestamp not null default current_timestamp,
  paid_at timestamp
);
create index idx_orders_user on orders(user_id, created_at);
create index idx_orders_course on orders(course_id);
create index idx_orders_status on orders(status);

create table payments (
  id varchar(40) primary key,
  order_id varchar(40) not null references orders(id) on delete cascade,
  provider varchar(30) not null,
  provider_ref varchar(120),
  status varchar(20) not null,               -- SUCCESS | FAILED | CANCELLED | REFUNDED
  amount_cents integer not null,
  currency varchar(3) not null,
  detail_json text,
  created_at timestamp not null default current_timestamp
);
create index idx_payments_order on payments(order_id);
