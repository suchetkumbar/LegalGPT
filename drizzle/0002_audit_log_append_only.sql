-- Defence in depth on top of the select/insert-only policies: the application
-- role cannot change or remove audit entries at all.
REVOKE UPDATE, DELETE, TRUNCATE ON TABLE audit_log FROM app_user;
