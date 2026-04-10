import { DeviceList, PrismaClient } from '@prisma/client';

export type TabletDisplayTheme = 'light' | 'dark';

export interface DeviceDisplaySettings {
    displayTheme: TabletDisplayTheme;
    forceBlackScreen: boolean;
}

export const DEFAULT_DEVICE_DISPLAY_SETTINGS: DeviceDisplaySettings = {
    displayTheme: 'dark',
    forceBlackScreen: false
};

const DEVICE_LIST_TABLE = '"DeviceList"';

export const isTabletDisplayTheme = (value: unknown): value is TabletDisplayTheme =>
    value === 'light' || value === 'dark';

export const normalizeDeviceDisplaySettings = (source: {
    displayTheme?: string | null;
    forceBlackScreen?: boolean | null;
}): DeviceDisplaySettings => ({
    displayTheme: isTabletDisplayTheme(source.displayTheme)
        ? source.displayTheme
        : DEFAULT_DEVICE_DISPLAY_SETTINGS.displayTheme,
    forceBlackScreen:
        typeof source.forceBlackScreen === 'boolean'
            ? source.forceBlackScreen
            : DEFAULT_DEVICE_DISPLAY_SETTINGS.forceBlackScreen
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
        ADD COLUMN IF NOT EXISTS "forceBlackScreen" BOOLEAN NOT NULL DEFAULT FALSE
    `);
};
