ALTER TABLE tablet_display_settings
    ADD COLUMN IF NOT EXISTS emergency_alert_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS emergency_alert_audio_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    ADD COLUMN IF NOT EXISTS emergency_alert_message_pl TEXT NOT NULL DEFAULT 'EWAKUACJA. Opuść budynek najbliższym bezpiecznym wyjściem ewakuacyjnym. Nie korzystaj z wind. Wykonuj polecenia obsługi.',
    ADD COLUMN IF NOT EXISTS emergency_alert_message_en TEXT NOT NULL DEFAULT 'EVACUATION. Leave the building using the nearest safe emergency exit. Do not use elevators. Follow staff instructions.',
    ADD COLUMN IF NOT EXISTS emergency_alert_updated_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS emergency_alert_updated_by TEXT;
