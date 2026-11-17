CREATE TABLE users (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    email text NOT NULL CHECK (email = lower(email)),
    password_hash text NOT NULL,
    verified_at timestamptz,
    disabled_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (email)
);

CREATE TABLE tenants (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    legal_name text NOT NULL CHECK (length(legal_name) BETWEEN 1 AND 160),
    display_name text NOT NULL CHECK (length(display_name) BETWEEN 1 AND 120),
    country text NOT NULL CHECK (country ~ '^[A-Z]{2}$'),
    time_zone text NOT NULL,
    status text NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft', 'pending_compliance', 'pending_number', 'active', 'suspended', 'closed')),
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE tenant_memberships (
    tenant_id uuid REFERENCES tenants (id),
    user_id uuid REFERENCES users (id),
    role text NOT NULL CHECK (role IN ('owner', 'admin', 'staff')),
    revoked_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, user_id)
);

CREATE INDEX tenant_memberships_user ON tenant_memberships (user_id, created_at, tenant_id)
    WHERE revoked_at IS NULL;

CREATE TABLE sessions (
    token_hash bytea PRIMARY KEY CHECK (octet_length(token_hash) = 32),
    tenant_id uuid NOT NULL,
    user_id uuid NOT NULL,
    expires_at timestamptz NOT NULL,
    FOREIGN KEY (tenant_id, user_id) REFERENCES tenant_memberships (tenant_id, user_id) ON DELETE CASCADE
);

CREATE INDEX sessions_expiry ON sessions (expires_at);

ALTER TABLE tenant_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_memberships FORCE ROW LEVEL SECURITY;
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenants FORCE ROW LEVEL SECURITY;

CREATE POLICY membership_self ON tenant_memberships FOR SELECT TO phone_app
    USING (user_id = nullif(current_setting('app.user_id', true), '')::uuid AND revoked_at IS NULL);

CREATE POLICY tenant_read ON tenants FOR SELECT TO phone_app
    USING (
        id = nullif(current_setting('app.tenant_id', true), '')::uuid
        AND EXISTS (SELECT 1 FROM tenant_memberships WHERE tenant_id = tenants.id)
    );

CREATE POLICY tenant_update_by_owner ON tenants FOR UPDATE TO phone_app
    USING (
        id = nullif(current_setting('app.tenant_id', true), '')::uuid
        AND status NOT IN ('suspended', 'closed')
        AND EXISTS (SELECT 1 FROM tenant_memberships WHERE tenant_id = tenants.id AND role = 'owner')
    );

GRANT SELECT ON users, tenant_memberships, tenants TO phone_app;
GRANT UPDATE (display_name, time_zone) ON tenants TO phone_app;
GRANT SELECT, INSERT, DELETE ON sessions TO phone_app;
