DROP POLICY tenant_signup ON tenants;
DROP POLICY membership_signup ON tenant_memberships;
REVOKE INSERT (id, email, password_hash, verified_at) ON users FROM phone_app;
REVOKE INSERT (id, legal_name, display_name, country, time_zone) ON tenants FROM phone_app;
REVOKE INSERT (tenant_id, user_id, role) ON tenant_memberships FROM phone_app;

CREATE FUNCTION public.claim_receptionist_signup(verification_hash bytea, account_password_hash text)
RETURNS TABLE (user_id uuid, tenant_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
SET row_security = off
AS $signup$
DECLARE
    claimed_email text;
    created_user uuid;
    created_tenant uuid;
BEGIN
    DELETE FROM public.signup_tokens AS token
    WHERE token.token_hash = verification_hash AND token.expires_at > now()
    RETURNING token.email INTO claimed_email;
    IF NOT FOUND THEN RETURN; END IF;

    INSERT INTO public.users (email, password_hash, verified_at)
    VALUES (claimed_email, account_password_hash, now())
    ON CONFLICT (email) DO NOTHING
    RETURNING id INTO created_user;
    IF NOT FOUND THEN RETURN; END IF;

    INSERT INTO public.tenants (legal_name, display_name, country, time_zone)
    VALUES ('New business', 'New business', 'CA', 'America/Vancouver')
    RETURNING id INTO created_tenant;

    INSERT INTO public.tenant_memberships (tenant_id, user_id, role)
    VALUES (created_tenant, created_user, 'owner');

    RETURN QUERY SELECT created_user, created_tenant;
END;
$signup$;

REVOKE ALL ON FUNCTION public.claim_receptionist_signup(bytea, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_receptionist_signup(bytea, text) TO phone_app;
