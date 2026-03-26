import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { registerTabletStream } from '../services/tabletStreamService';
import {
    DEFAULT_TABLET_NIGHT_MODE_SETTINGS,
    getTabletNightModeSettings
} from '../services/tabletDisplaySettingsService';

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
        const { deviceId } = req.body;

        if (!deviceId) {
            return res.status(400).json({ message: "DeviceId is required" });
        }

        let device = await prisma.deviceList.findUnique({
            where: { deviceId }
        });

        if (!device) {
            // Extract Metadata
            const ipAddress = (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress;
            const userAgent = req.headers['user-agent'];
            let deviceModel = null;

            if (userAgent) {
                const match = userAgent.match(/\((.*?)\)/);
                if (match && match[1]) {
                    deviceModel = match[1];
                }
            }

            // New device, create as PENDING
            device = await prisma.deviceList.create({
                data: {
                    deviceId,
                    status: 'PENDING',
                    deviceName: null,
                    deviceClassroom: null,
                    deviceURL: null,
                    lastSeen: new Date(),
                    ipAddress,
                    userAgent,
                    deviceModel
                }
            });
        } else {
            // Update lastSeen and metadata for existing device
            const ipAddress = (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress;
            const userAgent = req.headers['user-agent'];
            let deviceModel = device.deviceModel; // Keep existing if not found? Or update? Let's update.

            if (userAgent) {
                const match = userAgent.match(/\((.*?)\)/);
                if (match && match[1]) {
                    deviceModel = match[1];
                }
            }

            await prisma.deviceList.update({
                where: { deviceId },
                data: {
                    lastSeen: new Date(),
                    ipAddress,
                    userAgent,
                    deviceModel
                }
            });
        }

        const nightMode = await loadNightModeSettings();

        // Return status
        return res.json({
            status: device.status,
            config: device.status === 'ACTIVE' ? {
                department: device.deviceClassroom, // Simplified for now, assumming room stores building too or we fix schema later
                room: device.deviceClassroom,
                secretUrl: device.deviceURL,
                nightMode
            } : null
        });
    }

    // POST /api/registry/display-profile
    static async updateDisplayProfile(req: Request, res: Response) {
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
            config: device.status === 'ACTIVE' ? {
                // In legacy logic "room" often contained "Building/Room". 
                // We'll need to parse this in frontend or store separately.
                // For now, returning as is.
                room: device.deviceClassroom,
                secretUrl: device.deviceURL,
                nightMode
            } : null
        });
    }
}
