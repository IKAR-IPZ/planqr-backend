import { DeviceList, PrismaClient } from '@prisma/client';

export type TabletDisplayTheme = 'light' | 'dark';
export type DeviceBlackScreenMode = 'follow' | 'on' | 'off';

export interface DeviceDisplaySettings {
    displayTheme: TabletDisplayTheme;
    blackScreenMode: DeviceBlackScreenMode;
}

export const DEFAULT_DEVICE_DISPLAY_SETTINGS: DeviceDisplaySettings = {
    displayTheme: 'dark',
    blackScreenMode: 'follow'
};

const DEVICE_LIST_TABLE = '"DeviceList"';

export const isTabletDisplayTheme = (value: unknown): value is TabletDisplayTheme =>
    value === 'light' || value === 'dark';

export const isDeviceBlackScreenMode = (value: unknown): value is DeviceBlackScreenMode =>
    value === 'follow' || value === 'on' || value === 'off';

export const normalizeDeviceDisplaySettings = (source: {
    displayTheme?: string | null;
    blackScreenMode?: string | null;
    forceBlackScreen?: boolean | null;
}): DeviceDisplaySettings => ({
    displayTheme: isTabletDisplayTheme(source.displayTheme)
        ? source.displayTheme
        : DEFAULT_DEVICE_DISPLAY_SETTINGS.displayTheme,
    blackScreenMode: isDeviceBlackScreenMode(source.blackScreenMode)
        ? source.blackScreenMode
        : source.forceBlackScreen === true
            ? 'on'
            : DEFAULT_DEVICE_DISPLAY_SETTINGS.blackScreenMode
});

export const serializeDeviceDisplaySettings = (device: DeviceList): DeviceDisplaySettings =>
    normalizeDeviceDisplaySettings(device);

export const ensureDeviceListDisplaySettingsColumns = async (prisma: PrismaClient) => {
    await prisma.$executeRawUnsafe(`
        ALTER TABLE ${DEVICE_LIST_TABLE}
        ADD COLUMN IF NOT EXISTS "displayTheme" VARCHAR(16) NOT NULL DEFAULT 'dark'
    `);

    await prisma.$executeRawUnsafe(`
        ALTER TABLE ${DEVICE_LIST_TABLE}
        ADD COLUMN IF NOT EXISTS "blackScreenMode" VARCHAR(16) NOT NULL DEFAULT 'follow'
    `);

    const legacyForceBlackScreenColumn = await prisma.$queryRawUnsafe<
        Array<{ column_name: string }>
    >(`
        SELECT column_name
        FROM information_schema.columns
        WHERE table_name = 'DeviceList'
          AND column_name = 'forceBlackScreen'
        LIMIT 1
    `);

    if (legacyForceBlackScreenColumn.length > 0) {
        await prisma.$executeRawUnsafe(`
            UPDATE ${DEVICE_LIST_TABLE}
            SET "blackScreenMode" = 'on'
            WHERE "blackScreenMode" = 'follow'
              AND "forceBlackScreen" = TRUE
        `);
    }
};
