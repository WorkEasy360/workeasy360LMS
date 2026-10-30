-- The customer organisation's logo (a small data: image set under Admin → Settings), printed on certificates
-- as the issuer's branding. Nullable: without one, certificates show the organisation's name in text.
alter table settings add column org_logo text;
