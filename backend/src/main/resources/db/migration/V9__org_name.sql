-- The settings row shipped with a placeholder organisation name that ended up printed on certificates
-- ("Awarded … by Acme Corp"). Replace the placeholder wherever it is still unchanged; an organisation
-- that already set its real name under Admin → Settings is left alone.
update settings set org_name = 'WorkEasy360' where org_name = 'Acme Corp';
alter table settings alter column org_name set default 'WorkEasy360';
