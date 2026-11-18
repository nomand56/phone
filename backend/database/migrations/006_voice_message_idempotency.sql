CREATE POLICY receptionist_messages_voice_replay ON receptionist_messages FOR SELECT TO phone_app
    USING (
        tenant_id = nullif(current_setting('app.voice_tenant_id', true), '')::uuid
        AND call_sid = nullif(current_setting('app.voice_call_sid', true), '')
    );
