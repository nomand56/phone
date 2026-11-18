CREATE TABLE signup_tokens (
    email text PRIMARY KEY CHECK (email = lower(email)),
    token_hash bytea NOT NULL UNIQUE CHECK (octet_length(token_hash) = 32),
    expires_at timestamptz NOT NULL
);
CREATE INDEX signup_tokens_expiry ON signup_tokens (expires_at);

GRANT SELECT, INSERT, UPDATE, DELETE ON signup_tokens TO phone_app;
GRANT INSERT (id, email, password_hash, verified_at) ON users TO phone_app;
GRANT INSERT (id, legal_name, display_name, country, time_zone) ON tenants TO phone_app;
GRANT INSERT (tenant_id, user_id, role) ON tenant_memberships TO phone_app;

CREATE POLICY tenant_signup ON tenants FOR INSERT TO phone_app
    WITH CHECK (
        id = nullif(current_setting('app.tenant_id', true), '')::uuid
        AND status = 'draft'
    );

CREATE POLICY membership_signup ON tenant_memberships FOR INSERT TO phone_app
    WITH CHECK (
        tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
        AND user_id = nullif(current_setting('app.user_id', true), '')::uuid
        AND role = 'owner'
    );

CREATE TABLE receptionist_setup (
    tenant_id uuid PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
    profile jsonb,
    rules jsonb,
    previewed_at timestamptz,
    phone_preferences jsonb,
    updated_at timestamptz NOT NULL DEFAULT now(),
    CHECK (rules IS NULL OR profile IS NOT NULL),
    CHECK (previewed_at IS NULL OR rules IS NOT NULL)
);

ALTER TABLE receptionist_setup ENABLE ROW LEVEL SECURITY;
ALTER TABLE receptionist_setup FORCE ROW LEVEL SECURITY;
CREATE POLICY receptionist_setup_owner ON receptionist_setup TO phone_app
    USING (
        tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
        AND EXISTS (
            SELECT 1 FROM tenant_memberships m
            WHERE m.tenant_id = receptionist_setup.tenant_id AND m.role = 'owner'
        )
    )
    WITH CHECK (
        tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid
        AND EXISTS (
            SELECT 1 FROM tenant_memberships m
            WHERE m.tenant_id = receptionist_setup.tenant_id AND m.role = 'owner'
        )
    );

GRANT SELECT, INSERT, UPDATE ON receptionist_setup TO phone_app;
