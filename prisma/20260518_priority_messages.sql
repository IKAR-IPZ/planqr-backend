CREATE TABLE IF NOT EXISTS tablet_priority_message_templates (
    id VARCHAR(80) PRIMARY KEY,
    name TEXT NOT NULL,
    image_url TEXT NOT NULL,
    media_type VARCHAR(16) NOT NULL DEFAULT 'image',
    is_builtin BOOLEAN NOT NULL DEFAULT FALSE,
    sort_order INTEGER NOT NULL DEFAULT 100,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tablet_priority_message_assignments (
    device_id INTEGER PRIMARY KEY REFERENCES "DeviceList"(id) ON DELETE CASCADE,
    template_id VARCHAR(80) NOT NULL REFERENCES tablet_priority_message_templates(id),
    active BOOLEAN NOT NULL DEFAULT TRUE,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_by TEXT
);

CREATE INDEX IF NOT EXISTS idx_tablet_priority_message_assignments_active
    ON tablet_priority_message_assignments(active);
