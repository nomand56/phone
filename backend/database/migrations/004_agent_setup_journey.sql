ALTER TABLE receptionist_setup
    ADD COLUMN discovery jsonb NOT NULL DEFAULT '{}'::jsonb,
    ADD COLUMN training jsonb,
    ADD COLUMN voice_choice text CHECK (voice_choice IN ('juniper','jessica','eric','enrique')),
    ADD COLUMN voice_status text CHECK (voice_status IN ('tested','skipped')),
    ADD COLUMN selected_number text CHECK (selected_number ~ '^\+[1-9][0-9]{7,14}$'),
    ADD COLUMN checkout_cadence text CHECK (checkout_cadence IN ('monthly','yearly')),
    ADD COLUMN sandbox_completed_at timestamptz;
