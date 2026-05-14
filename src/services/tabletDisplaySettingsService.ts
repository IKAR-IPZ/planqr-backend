import { PrismaClient } from '@prisma/client';

const TABLET_DISPLAY_SETTINGS_ID = 1;
const TABLET_DISPLAY_SETTINGS_TABLE = 'tablet_display_settings';

export interface TabletNightModeSettings {
    enabled: boolean;
    startTime: string;
    endTime: string;
    blackScreenAfterScheduleEnd: boolean;
}

export interface TabletEmergencyAlertSettings {
    enabled: boolean;
    audioEnabled: boolean;
    messagePl: string;
    messageEn: string;
    updatedAt: Date | null;
    updatedBy: string | null;
}

export const DEFAULT_TABLET_NIGHT_MODE_SETTINGS: TabletNightModeSettings = {
    enabled: false,
    startTime: '22:00',
    endTime: '06:00',
    blackScreenAfterScheduleEnd: false
};

export const DEFAULT_TABLET_EMERGENCY_ALERT_SETTINGS: TabletEmergencyAlertSettings = {
    enabled: false,
    audioEnabled: true,
    messagePl: 'EWAKUACJA. Opuść budynek najbliższym bezpiecznym wyjściem ewakuacyjnym. Nie korzystaj z wind. Wykonuj polecenia obsługi.',
    messageEn: 'EVACUATION. Leave the building using the nearest safe emergency exit. Do not use elevators. Follow staff instructions.',
    updatedAt: null,
    updatedBy: null
};

interface TabletNightModeRow {
    night_mode_enabled: boolean;
    night_mode_start: string;
    night_mode_end: string;
    black_screen_after_schedule_end: boolean;
}

interface TabletEmergencyAlertRow {
    emergency_alert_enabled: boolean;
    emergency_alert_audio_enabled: boolean;
    emergency_alert_message_pl: string;
    emergency_alert_message_en: string;
    emergency_alert_updated_at: Date | null;
    emergency_alert_updated_by: string | null;
}

const mapNightModeSettings = (settings: TabletNightModeRow): TabletNightModeSettings => ({
    enabled: settings.night_mode_enabled,
    startTime: settings.night_mode_start,
    endTime: settings.night_mode_end,
    blackScreenAfterScheduleEnd: settings.black_screen_after_schedule_end
});

const mapEmergencyAlertSettings = (settings: TabletEmergencyAlertRow): TabletEmergencyAlertSettings => ({
    enabled: settings.emergency_alert_enabled,
    audioEnabled: settings.emergency_alert_audio_enabled,
    messagePl: settings.emergency_alert_message_pl || DEFAULT_TABLET_EMERGENCY_ALERT_SETTINGS.messagePl,
    messageEn: settings.emergency_alert_message_en || DEFAULT_TABLET_EMERGENCY_ALERT_SETTINGS.messageEn,
    updatedAt: settings.emergency_alert_updated_at,
    updatedBy: settings.emergency_alert_updated_by
});

const ensureTabletDisplaySettingsTable = async (prisma: PrismaClient) => {
    await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS ${TABLET_DISPLAY_SETTINGS_TABLE} (
            id INTEGER PRIMARY KEY,
            night_mode_enabled BOOLEAN NOT NULL DEFAULT FALSE,
            night_mode_start VARCHAR(5) NOT NULL DEFAULT '22:00',
            night_mode_end VARCHAR(5) NOT NULL DEFAULT '06:00',
            black_screen_after_schedule_end BOOLEAN NOT NULL DEFAULT FALSE,
            emergency_alert_enabled BOOLEAN NOT NULL DEFAULT FALSE,
            emergency_alert_audio_enabled BOOLEAN NOT NULL DEFAULT TRUE,
            emergency_alert_message_pl TEXT NOT NULL DEFAULT '${DEFAULT_TABLET_EMERGENCY_ALERT_SETTINGS.messagePl.replace(/'/g, "''")}',
            emergency_alert_message_en TEXT NOT NULL DEFAULT '${DEFAULT_TABLET_EMERGENCY_ALERT_SETTINGS.messageEn.replace(/'/g, "''")}',
            emergency_alert_updated_at TIMESTAMPTZ,
            emergency_alert_updated_by TEXT,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    `);

    await prisma.$executeRawUnsafe(`
        ALTER TABLE ${TABLET_DISPLAY_SETTINGS_TABLE}
        ADD COLUMN IF NOT EXISTS black_screen_after_schedule_end BOOLEAN NOT NULL DEFAULT FALSE
    `);

    await prisma.$executeRawUnsafe(`
        ALTER TABLE ${TABLET_DISPLAY_SETTINGS_TABLE}
        ADD COLUMN IF NOT EXISTS emergency_alert_enabled BOOLEAN NOT NULL DEFAULT FALSE
    `);

    await prisma.$executeRawUnsafe(`
        ALTER TABLE ${TABLET_DISPLAY_SETTINGS_TABLE}
        ADD COLUMN IF NOT EXISTS emergency_alert_audio_enabled BOOLEAN NOT NULL DEFAULT TRUE
    `);

    await prisma.$executeRawUnsafe(`
        ALTER TABLE ${TABLET_DISPLAY_SETTINGS_TABLE}
        ADD COLUMN IF NOT EXISTS emergency_alert_message_pl TEXT NOT NULL DEFAULT '${DEFAULT_TABLET_EMERGENCY_ALERT_SETTINGS.messagePl.replace(/'/g, "''")}'
    `);

    await prisma.$executeRawUnsafe(`
        ALTER TABLE ${TABLET_DISPLAY_SETTINGS_TABLE}
        ADD COLUMN IF NOT EXISTS emergency_alert_message_en TEXT NOT NULL DEFAULT '${DEFAULT_TABLET_EMERGENCY_ALERT_SETTINGS.messageEn.replace(/'/g, "''")}'
    `);

    await prisma.$executeRawUnsafe(`
        ALTER TABLE ${TABLET_DISPLAY_SETTINGS_TABLE}
        ADD COLUMN IF NOT EXISTS emergency_alert_updated_at TIMESTAMPTZ
    `);

    await prisma.$executeRawUnsafe(`
        ALTER TABLE ${TABLET_DISPLAY_SETTINGS_TABLE}
        ADD COLUMN IF NOT EXISTS emergency_alert_updated_by TEXT
    `);
};

const ensureDefaultTabletDisplaySettingsRow = async (prisma: PrismaClient) => {
    await prisma.$executeRawUnsafe(
        `
            INSERT INTO ${TABLET_DISPLAY_SETTINGS_TABLE} (
                id,
                night_mode_enabled,
                night_mode_start,
                night_mode_end,
                black_screen_after_schedule_end,
                emergency_alert_enabled,
                emergency_alert_audio_enabled,
                emergency_alert_message_pl,
                emergency_alert_message_en,
                created_at,
                updated_at
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), NOW())
            ON CONFLICT (id) DO NOTHING
        `,
        TABLET_DISPLAY_SETTINGS_ID,
        DEFAULT_TABLET_NIGHT_MODE_SETTINGS.enabled,
        DEFAULT_TABLET_NIGHT_MODE_SETTINGS.startTime,
        DEFAULT_TABLET_NIGHT_MODE_SETTINGS.endTime,
        DEFAULT_TABLET_NIGHT_MODE_SETTINGS.blackScreenAfterScheduleEnd,
        DEFAULT_TABLET_EMERGENCY_ALERT_SETTINGS.enabled,
        DEFAULT_TABLET_EMERGENCY_ALERT_SETTINGS.audioEnabled,
        DEFAULT_TABLET_EMERGENCY_ALERT_SETTINGS.messagePl,
        DEFAULT_TABLET_EMERGENCY_ALERT_SETTINGS.messageEn
    );
};

export const getTabletNightModeSettings = async (
    prisma: PrismaClient
): Promise<TabletNightModeSettings> => {
    await ensureTabletDisplaySettingsTable(prisma);
    await ensureDefaultTabletDisplaySettingsRow(prisma);

    const rows = await prisma.$queryRawUnsafe<TabletNightModeRow[]>(
        `
            SELECT
                night_mode_enabled,
                night_mode_start,
                night_mode_end,
                black_screen_after_schedule_end
            FROM ${TABLET_DISPLAY_SETTINGS_TABLE}
            WHERE id = $1
            LIMIT 1
        `,
        TABLET_DISPLAY_SETTINGS_ID
    );

    return rows[0] ? mapNightModeSettings(rows[0]) : DEFAULT_TABLET_NIGHT_MODE_SETTINGS;
};

export const getTabletEmergencyAlertSettings = async (
    prisma: PrismaClient
): Promise<TabletEmergencyAlertSettings> => {
    await ensureTabletDisplaySettingsTable(prisma);
    await ensureDefaultTabletDisplaySettingsRow(prisma);

    const rows = await prisma.$queryRawUnsafe<TabletEmergencyAlertRow[]>(
        `
            SELECT
                emergency_alert_enabled,
                emergency_alert_audio_enabled,
                emergency_alert_message_pl,
                emergency_alert_message_en,
                emergency_alert_updated_at,
                emergency_alert_updated_by
            FROM ${TABLET_DISPLAY_SETTINGS_TABLE}
            WHERE id = $1
            LIMIT 1
        `,
        TABLET_DISPLAY_SETTINGS_ID
    );

    return rows[0]
        ? mapEmergencyAlertSettings(rows[0])
        : DEFAULT_TABLET_EMERGENCY_ALERT_SETTINGS;
};

export const updateTabletNightModeSettings = async (
    prisma: PrismaClient,
    settings: TabletNightModeSettings
) => {
    await ensureTabletDisplaySettingsTable(prisma);

    const rows = await prisma.$queryRawUnsafe<TabletNightModeRow[]>(
        `
            INSERT INTO ${TABLET_DISPLAY_SETTINGS_TABLE} (
                id,
                night_mode_enabled,
                night_mode_start,
                night_mode_end,
                black_screen_after_schedule_end,
                created_at,
                updated_at
            )
            VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
            ON CONFLICT (id) DO UPDATE SET
                night_mode_enabled = EXCLUDED.night_mode_enabled,
                night_mode_start = EXCLUDED.night_mode_start,
                night_mode_end = EXCLUDED.night_mode_end,
                black_screen_after_schedule_end = EXCLUDED.black_screen_after_schedule_end,
                updated_at = NOW()
            RETURNING
                night_mode_enabled,
                night_mode_start,
                night_mode_end,
                black_screen_after_schedule_end
        `,
        TABLET_DISPLAY_SETTINGS_ID,
        settings.enabled,
        settings.startTime,
        settings.endTime,
        settings.blackScreenAfterScheduleEnd
    );

    return rows[0] ? mapNightModeSettings(rows[0]) : settings;
};

export const updateTabletEmergencyAlertSettings = async (
    prisma: PrismaClient,
    settings: Pick<TabletEmergencyAlertSettings, 'enabled' | 'audioEnabled' | 'messagePl' | 'messageEn'>,
    updatedBy: string | null
) => {
    await ensureTabletDisplaySettingsTable(prisma);

    const rows = await prisma.$queryRawUnsafe<TabletEmergencyAlertRow[]>(
        `
            INSERT INTO ${TABLET_DISPLAY_SETTINGS_TABLE} (
                id,
                emergency_alert_enabled,
                emergency_alert_audio_enabled,
                emergency_alert_message_pl,
                emergency_alert_message_en,
                emergency_alert_updated_at,
                emergency_alert_updated_by,
                created_at,
                updated_at
            )
            VALUES ($1, $2, $3, $4, $5, NOW(), $6, NOW(), NOW())
            ON CONFLICT (id) DO UPDATE SET
                emergency_alert_enabled = EXCLUDED.emergency_alert_enabled,
                emergency_alert_audio_enabled = EXCLUDED.emergency_alert_audio_enabled,
                emergency_alert_message_pl = EXCLUDED.emergency_alert_message_pl,
                emergency_alert_message_en = EXCLUDED.emergency_alert_message_en,
                emergency_alert_updated_at = EXCLUDED.emergency_alert_updated_at,
                emergency_alert_updated_by = EXCLUDED.emergency_alert_updated_by,
                updated_at = NOW()
            RETURNING
                emergency_alert_enabled,
                emergency_alert_audio_enabled,
                emergency_alert_message_pl,
                emergency_alert_message_en,
                emergency_alert_updated_at,
                emergency_alert_updated_by
        `,
        TABLET_DISPLAY_SETTINGS_ID,
        settings.enabled,
        settings.audioEnabled,
        settings.messagePl,
        settings.messageEn,
        updatedBy
    );

    return rows[0] ? mapEmergencyAlertSettings(rows[0]) : {
        ...settings,
        updatedAt: new Date(),
        updatedBy
    };
};
