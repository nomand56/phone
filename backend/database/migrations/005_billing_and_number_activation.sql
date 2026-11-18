CREATE TABLE receptionist_activation (
    tenant_id uuid PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
    attempt_id uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
    number text NOT NULL CHECK (number ~ '^\+[1-9][0-9]{7,14}$'),
    cadence text NOT NULL CHECK (cadence IN ('monthly','yearly')),
    stripe_checkout_id text UNIQUE,
    stripe_subscription_id text UNIQUE,
    stripe_status text NOT NULL DEFAULT 'checkout',
    state text NOT NULL DEFAULT 'checkout' CHECK (state IN ('checkout','provisioning','active','unavailable')),
    twilio_sid text UNIQUE,
    retry_at timestamptz,
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX receptionist_active_number ON receptionist_activation(number) WHERE twilio_sid IS NOT NULL;

ALTER TABLE receptionist_activation ENABLE ROW LEVEL SECURITY;
ALTER TABLE receptionist_activation FORCE ROW LEVEL SECURITY;
CREATE POLICY receptionist_activation_access ON receptionist_activation TO phone_app
    USING (
      tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid AND EXISTS (
        SELECT 1 FROM tenant_memberships m WHERE m.tenant_id = receptionist_activation.tenant_id AND m.role = 'owner'
      )
      OR tenant_id = nullif(current_setting('app.billing_tenant_id', true), '')::uuid
    );
GRANT SELECT, INSERT, UPDATE ON receptionist_activation TO phone_app;

CREATE FUNCTION public.receptionist_destination(destination text)
RETURNS TABLE (tenant_key uuid, profile jsonb, rules jsonb, capabilities jsonb)
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
SET row_security = off
AS $route$
    SELECT a.tenant_id, s.profile, s.rules, s.discovery->'capabilities'
    FROM public.receptionist_activation a
    JOIN public.receptionist_setup s USING (tenant_id)
    JOIN public.tenants t ON t.id = a.tenant_id
    WHERE a.number = destination AND a.state = 'active' AND a.twilio_sid IS NOT NULL
      AND a.stripe_status IN ('trialing', 'active') AND t.status NOT IN ('suspended', 'closed')
      AND s.profile IS NOT NULL AND s.rules IS NOT NULL
$route$;
REVOKE ALL ON FUNCTION public.receptionist_destination(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.receptionist_destination(text) TO phone_app;

CREATE TABLE receptionist_messages (
    call_sid text PRIMARY KEY,
    tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    callback_number text,
    message text NOT NULL,
    received_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX receptionist_messages_tenant_time ON receptionist_messages(tenant_id, received_at DESC);
ALTER TABLE receptionist_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE receptionist_messages FORCE ROW LEVEL SECURITY;
CREATE POLICY receptionist_messages_owner ON receptionist_messages FOR SELECT TO phone_app
    USING (
      tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid AND EXISTS (
        SELECT 1 FROM tenant_memberships m WHERE m.tenant_id = receptionist_messages.tenant_id AND m.role = 'owner'
      )
    );
CREATE POLICY receptionist_messages_voice ON receptionist_messages FOR INSERT TO phone_app
    WITH CHECK (tenant_id = nullif(current_setting('app.voice_tenant_id', true), '')::uuid);
GRANT SELECT, INSERT ON receptionist_messages TO phone_app;
