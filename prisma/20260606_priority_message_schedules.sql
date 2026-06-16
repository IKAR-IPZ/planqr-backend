CREATE TABLE IF NOT EXISTS tablet_priority_message_manual_assignments (
    device_id INTEGER PRIMARY KEY REFERENCES "DeviceList"(id) ON DELETE CASCADE,
    template_id VARCHAR(80) NOT NULL REFERENCES tablet_priority_message_templates(id) ON DELETE CASCADE,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_by TEXT
);

CREATE TABLE IF NOT EXISTS tablet_priority_message_schedules (
    id VARCHAR(64) PRIMARY KEY,
    template_id VARCHAR(80) NOT NULL REFERENCES tablet_priority_message_templates(id) ON DELETE CASCADE,
    priority INTEGER NOT NULL CHECK (priority BETWEEN 1 AND 10),
    target_type VARCHAR(16) NOT NULL CHECK (target_type IN ('devices', 'faculty')),
    faculty_code VARCHAR(32),
    starts_at TIMESTAMPTZ NOT NULL,
    ends_at TIMESTAMPTZ NOT NULL,
    created_by TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (ends_at > starts_at),
    CHECK (
        (target_type = 'faculty' AND faculty_code IS NOT NULL)
        OR (target_type = 'devices' AND faculty_code IS NULL)
    )
);

CREATE TABLE IF NOT EXISTS tablet_priority_message_schedule_targets (
    schedule_id VARCHAR(64) NOT NULL REFERENCES tablet_priority_message_schedules(id) ON DELETE CASCADE,
    device_id INTEGER NOT NULL REFERENCES "DeviceList"(id) ON DELETE CASCADE,
    PRIMARY KEY (schedule_id, device_id)
);

CREATE TABLE IF NOT EXISTS tablet_priority_message_presets (
    id VARCHAR(64) PRIMARY KEY,
    name TEXT NOT NULL,
    template_id VARCHAR(80) NOT NULL REFERENCES tablet_priority_message_templates(id) ON DELETE CASCADE,
    priority INTEGER NOT NULL CHECK (priority BETWEEN 1 AND 10),
    duration_mode VARCHAR(24) NOT NULL CHECK (
        duration_mode IN ('tomorrow', 'end_of_day', 'end_of_week')
    ),
    start_offset_days SMALLINT NOT NULL DEFAULT 0 CHECK (start_offset_days BETWEEN 0 AND 3),
    duration_days SMALLINT NOT NULL DEFAULT 1 CHECK (duration_days BETWEEN 1 AND 3),
    created_by TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tablet_priority_message_preset_seed_state (
    id SMALLINT PRIMARY KEY CHECK (id = 1),
    seeded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE tablet_priority_message_presets
    ADD COLUMN IF NOT EXISTS start_offset_days SMALLINT NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS duration_days SMALLINT NOT NULL DEFAULT 1;

ALTER TABLE tablet_priority_message_assignments
    ADD COLUMN IF NOT EXISTS schedule_id VARCHAR(64),
    ADD COLUMN IF NOT EXISTS priority INTEGER,
    ADD COLUMN IF NOT EXISTS source_migrated BOOLEAN NOT NULL DEFAULT FALSE;

INSERT INTO tablet_priority_message_manual_assignments (
    device_id,
    template_id,
    updated_at,
    updated_by
)
SELECT device_id, template_id, updated_at, updated_by
FROM tablet_priority_message_assignments
WHERE active = TRUE
  AND schedule_id IS NULL
  AND source_migrated = FALSE
ON CONFLICT (device_id) DO NOTHING;

UPDATE tablet_priority_message_assignments
SET source_migrated = TRUE
WHERE source_migrated = FALSE;

CREATE INDEX IF NOT EXISTS idx_tablet_priority_message_schedules_window
    ON tablet_priority_message_schedules(starts_at, ends_at);

CREATE INDEX IF NOT EXISTS idx_tablet_priority_message_schedules_faculty
    ON tablet_priority_message_schedules(faculty_code);

CREATE INDEX IF NOT EXISTS idx_tablet_priority_message_schedule_targets_device
    ON tablet_priority_message_schedule_targets(device_id);
