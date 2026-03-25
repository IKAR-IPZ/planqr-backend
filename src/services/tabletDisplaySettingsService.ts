import { PrismaClient } from '@prisma/client';

const TABLET_DISPLAY_SETTINGS_ID = 1;
const TABLET_DISPLAY_SETTINGS_TABLE = 'tablet_display_settings';

export interface TabletNightModeSettings {
    enabled: boolean;
    startTime: string;
    endTime: string;
}

export const DEFAULT_TABLET_NIGHT_MODE_SETTINGS: TabletNightModeSettings = {
    enabled: false,
    startTime: '22:00',
    endTime: '06:00'
};

interface TabletNightModeRow {
    night_mode_enabled: boolean;
    night_mode_start: string;
    night_mode_end: string;
}

const mapNightModeSettings = (settings: TabletNightModeRow): TabletNightModeSettings => ({
    enabled: settings.night_mode_enabled,
    startTime: settings.night_mode_start,
    endTime: settings.night_mode_end
});

const ensureTabletDisplaySettingsTable = async (prisma: PrismaClient) => {
    await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS ${TABLET_DISPLAY_SETTINGS_TABLE} (
            id INTEGER PRIMARY KEY,
            night_mode_enabled BOOLEAN NOT NULL DEFAULT FALSE,
            night_mode_start VARCHAR(5) NOT NULL DEFAULT '22:00',
            night_mode_end VARCHAR(5) NOT NULL DEFAULT '06:00',
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
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
                created_at,
                updated_at
            )
            VALUES ($1, $2, $3, $4, NOW(), NOW())
            ON CONFLICT (id) DO NOTHING
        `,
        TABLET_DISPLAY_SETTINGS_ID,
        DEFAULT_TABLET_NIGHT_MODE_SETTINGS.enabled,
        DEFAULT_TABLET_NIGHT_MODE_SETTINGS.startTime,
        DEFAULT_TABLET_NIGHT_MODE_SETTINGS.endTime
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
                night_mode_end
            FROM ${TABLET_DISPLAY_SETTINGS_TABLE}
            WHERE id = $1
            LIMIT 1
        `,
        TABLET_DISPLAY_SETTINGS_ID
    );

    return rows[0] ? mapNightModeSettings(rows[0]) : DEFAULT_TABLET_NIGHT_MODE_SETTINGS;
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
                created_at,
                updated_at
            )
            VALUES ($1, $2, $3, $4, NOW(), NOW())
            ON CONFLICT (id) DO UPDATE SET
                night_mode_enabled = EXCLUDED.night_mode_enabled,
                night_mode_start = EXCLUDED.night_mode_start,
                night_mode_end = EXCLUDED.night_mode_end,
                updated_at = NOW()
            RETURNING
                night_mode_enabled,
                night_mode_start,
                night_mode_end
        `,
        TABLET_DISPLAY_SETTINGS_ID,
        settings.enabled,
        settings.startTime,
        settings.endTime
    );

    return rows[0] ? mapNightModeSettings(rows[0]) : settings;
};
