import { Request, Response } from 'express';
import { DeviceList, PrismaClient } from '@prisma/client';
import { registerTabletStream } from '../services/tabletStreamService';
import {
    DEFAULT_TABLET_NIGHT_MODE_SETTINGS,
    getTabletNightModeSettings
} from '../services/tabletDisplaySettingsService';
import {
    ensureDeviceListDisplaySettingsColumns,
    serializeDeviceDisplaySettings
} from '../services/deviceDisplaySettingsService';
import { generateDeviceSecret } from '../services/deviceSecretService';

const prisma = new PrismaClient();
const MAX_REASONABLE_DIMENSION_PX = 20000;
const MAX_REASONABLE_DEVICE_PIXEL_RATIO = 20;

interface DisplayProfilePayload {
    viewportWidthPx: number;
    viewportHeightPx: number;
    screenWidthPx: number;
    screenHeightPx: number;
    devicePixelRatio: number;
    screenOrientation: string;
}

const loadNightModeSettings = async () => {
    try {
        return await getTabletNightModeSettings(prisma);
    } catch (error) {
        console.error('[Registry] Failed to load tablet night mode settings:', error);
        return DEFAULT_TABLET_NIGHT_MODE_SETTINGS;
    }
};

const parsePositiveInteger = (value: unknown) => {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        return null;
    }

    const roundedValue = Math.round(value);
    if (roundedValue < 1 || roundedValue > MAX_REASONABLE_DIMENSION_PX) {
        return null;
    }

    return roundedValue;
};

const parseDisplayProfilePayload = (
    body: Request['body']
): { profile?: DisplayProfilePayload; error?: string } => {
    const viewportWidthPx = parsePositiveInteger(body?.viewportWidthPx);
    const viewportHeightPx = parsePositiveInteger(body?.viewportHeightPx);
    const screenWidthPx = parsePositiveInteger(body?.screenWidthPx);
    const screenHeightPx = parsePositiveInteger(body?.screenHeightPx);
    const screenOrientation =
        typeof body?.screenOrientation === 'string' ? body.screenOrientation.trim() : '';
    const devicePixelRatio =
        typeof body?.devicePixelRatio === 'number' && Number.isFinite(body.devicePixelRatio)
            ? body.devicePixelRatio
            : null;

    if (!viewportWidthPx || !viewportHeightPx || !screenWidthPx || !screenHeightPx) {
        return { error: 'Wymiary ekranu muszą być dodatnimi liczbami.' };
    }

    if (
        devicePixelRatio === null ||
        devicePixelRatio <= 0 ||
        devicePixelRatio > MAX_REASONABLE_DEVICE_PIXEL_RATIO
    ) {
        return { error: 'devicePixelRatio musi być dodatnią liczbą.' };
    }

    if (!screenOrientation || screenOrientation.length > 64) {
        return { error: 'screenOrientation jest wymagane.' };
    }

    return {
        profile: {
            viewportWidthPx,
            viewportHeightPx,
            screenWidthPx,
            screenHeightPx,
            devicePixelRatio,
            screenOrientation
        }
    };
};

const buildDeviceConfig = (
    device: DeviceList | null,
    nightMode: Awaited<ReturnType<typeof loadNightModeSettings>>
) => {
    if (!device || device.status !== 'ACTIVE') {
        return null;
    }

    const displaySettings = serializeDeviceDisplaySettings(device);

    return {
        department: device.deviceClassroom,
        room: device.deviceClassroom,
        secretUrl: device.deviceURL,
        nightMode,
        displayTheme: displaySettings.displayTheme,
        blackScreenMode: displaySettings.blackScreenMode
    };
};

export class RegistryController {

    // GET /api/registry/stream/{deviceId}
    static async stream(req: Request, res: Response) {
        const { deviceId } = req.params;

        if (!deviceId) {
            return res.status(400).json({ message: "DeviceId is required" });
        }

        registerTabletStream(deviceId, res);
        return;
    }

    // POST /api/registry/handshake
    static async handshake(req: Request, res: Response) {
        await ensureDeviceListDisplaySettingsColumns(prisma);
        const { deviceId } = req.body;

        if (!deviceId) {
            return res.status(400).json({ message: "DeviceId is required" });
        }

        let device = await prisma.deviceList.findUnique({
            where: { deviceId }
        });

        if (!device) {
            // New device, create as PENDING
            device = await prisma.deviceList.create({
                data: {
                    deviceId,
                    status: 'PENDING',
                    deviceClassroom: null,
                    deviceURL: generateDeviceSecret(),
                    lastSeen: new Date()
                }
            });
        } else {
            device = await prisma.deviceList.update({
                where: { deviceId },
                data: {
                    lastSeen: new Date(),
                    ...(device.deviceURL ? {} : { deviceURL: generateDeviceSecret() })
                }
            });
        }

        const nightMode = await loadNightModeSettings();

        // Return status
        return res.json({
            status: device.status,
            config: buildDeviceConfig(device, nightMode)
        });
    }

    // POST /api/registry/display-profile
    static async updateDisplayProfile(req: Request, res: Response) {
        await ensureDeviceListDisplaySettingsColumns(prisma);
        const { deviceId } = req.body;

        if (typeof deviceId !== 'string' || !deviceId.trim()) {
            return res.status(400).json({ message: 'DeviceId is required' });
        }

        const parsed = parseDisplayProfilePayload(req.body);
        if (!parsed.profile) {
            return res.status(400).json({ message: parsed.error });
        }

        const existingDevice = await prisma.deviceList.findUnique({
            where: { deviceId }
        });

        if (!existingDevice) {
            return res.status(404).json({ message: 'Device not found' });
        }

        const updatedDevice = await prisma.deviceList.update({
            where: { deviceId },
            data: {
                ...parsed.profile,
                displayProfileReportedAt: new Date(),
                lastSeen: new Date()
            }
        });

        return res.status(200).json({
            message: 'Zapisano profil ekranu urządzenia.',
            deviceId: updatedDevice.deviceId,
            displayProfileReportedAt: updatedDevice.displayProfileReportedAt
        });
    }

    // GET /api/registry/status/:deviceId
    static async checkStatus(req: Request, res: Response) {
        await ensureDeviceListDisplaySettingsColumns(prisma);
        const { deviceId } = req.params;

        const device = await prisma.deviceList.findUnique({
            where: { deviceId }
        });

        if (device) {
            await prisma.deviceList.update({
                where: { deviceId },
                data: { lastSeen: new Date() }
            });
        }

        if (!device) {
            return res.status(404).json({ message: "Device not found" });
        }

        const nightMode = await loadNightModeSettings();

        return res.json({
            status: device.status,
            config: buildDeviceConfig(device, nightMode)
        });
    }
}
