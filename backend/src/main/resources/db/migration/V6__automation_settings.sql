-- Automation rules (which learning notifications the platform sends) live on the org settings singleton.
-- Notifications themselves already have their table (V1); this milestone makes the backend authoritative for them.
alter table settings add column automation_json text;
update settings set automation_json = '{"enrolmentNotifications":true,"dueReminders":true,"certificateExpiry":true,"reviewNotifications":true,"discussionReplies":true}' where automation_json is null;
create index if not exists idx_notifications_user_at on notifications(user_id, at);
