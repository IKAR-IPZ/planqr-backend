import { Request, Response } from 'express';
import { DeviceList, PrismaClient } from '@prisma/client';
import {
    broadcastTabletCommand,
    buildTabletPath,
    getConnectedTabletCount,
    hasConnectedTabletStream,
    sendTabletCommandToDevice,
    TabletCommand,
    TabletDeviceConfig
} from '../services/tabletStreamService';
import {
    getTabletNightModeSettings,
    TabletNightModeSettings,
    updateTabletNightModeSettings
} from '../services/tabletDisplaySettingsService';

const prisma = new PrismaClient();
const NIGHT_MODE_TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;
const TABLET_OFFLINE_THRESHOLD_MS = 75 * 1000;

type DeviceConnectionStatus = 'PENDING' | 'ONLINE' | 'OFFLINE';

const toTabletConfig = (
    device: DeviceList,
    nightMode: TabletNightModeSettings
): TabletDeviceConfig => ({
    status: device.status,
    room: device.deviceClassroom,
    secretUrl: device.deviceURL,
    nightMode
});

const isValidNightModeTime = (value: string) => NIGHT_MODE_TIME_PATTERN.test(value);

const getDeviceConnectionStatus = (device: DeviceList): DeviceConnectionStatus => {
    if (device.status !== 'ACTIVE') {
        return 'PENDING';
    }

    if (hasConnectedTabletStream(device.deviceId)) {
        return 'ONLINE';
    }

    const heartbeatAgeMs = Date.now() - device.lastSeen.getTime();
    return heartbeatAgeMs <= TABLET_OFFLINE_THRESHOLD_MS ? 'ONLINE' : 'OFFLINE';
};

const serializeDevice = (device: DeviceList) => {
    const connectionStatus = getDeviceConnectionStatus(device);

    return {
        ...device,
        connectionStatus,
        isConnected: connectionStatus === 'ONLINE'
    };
};

const parseNightModeSettingsPayload = (
    body: Request['body']
): { settings?: TabletNightModeSettings; error?: string } => {
    const enabled = typeof body?.enabled === 'boolean' ? body.enabled : null;
    const startTime = typeof body?.startTime === 'string' ? body.startTime.trim() : '';
    const endTime = typeof body?.endTime === 'string' ? body.endTime.trim() : '';

    if (enabled === null) {
        return { error: 'Pole enabled musi być wartością logiczną.' };
    }

    if (!isValidNightModeTime(startTime) || !isValidNightModeTime(endTime)) {
        return { error: 'Godziny muszą mieć format HH:MM.' };
    }

    if (startTime === endTime) {
        return { error: 'Godzina rozpoczęcia i zakończenia nie mogą być takie same.' };
    }

    return {
        settings: {
            enabled,
            startTime,
            endTime
        }
    };
};

const buildDeviceCommand = (
    device: DeviceList,
    reason: string,
    nightMode: TabletNightModeSettings,
    options?: {
        fallbackType?: Extract<TabletCommand['type'], 'reload' | 'registry-reset' | 'config-updated'>;
        hardReload?: boolean;
    }
): TabletCommand => {
    const fallbackType = options?.fallbackType ?? 'config-updated';
    const hardReload = options?.hardReload ?? true;
    const issuedAt = new Date().toISOString();
    const config = toTabletConfig(device, nightMode);

    if (device.status === 'ACTIVE' && device.deviceClassroom && device.deviceURL) {
        return {
            type: fallbackType === 'registry-reset' ? 'config-updated' : fallbackType,
            issuedAt,
            hardReload,
            reason,
            path: buildTabletPath(device.deviceClassroom, device.deviceURL),
            config
        };
    }

    return {
        type: 'registry-reset',
        issuedAt,
        hardReload: true,
        reason,
        path: '/registry',
        config
    };
};

export class DeviceListController {

    // GET /api/devices
    static async getDevices(req: Request, res: Response) {
        const devices = await prisma.deviceList.findMany();
        res.json(devices.map(serializeDevice));
    }

    // GET /api/devices/{id}
    static async getDevice(req: Request, res: Response) {
        const id = parseInt(req.params.id);
        const device = await prisma.deviceList.findUnique({ where: { id } });
        if (!device) {
            res.sendStatus(404);
            return;
        }
        res.json(serializeDevice(device));
    }

    // GET /api/devices/display-settings
    static async getDisplaySettings(req: Request, res: Response) {
        try {
            const nightMode = await getTabletNightModeSettings(prisma);
            res.json({ nightMode });
        } catch (error) {
            console.error('Error fetching display settings:', error);
            res.status(500).json({
                message: 'Nie udało się pobrać ustawień trybu nocnego tabletów.'
            });
        }
    }

    // PUT /api/devices/display-settings
    static async updateDisplaySettings(req: Request, res: Response) {
        const parsed = parseNightModeSettingsPayload(req.body);

        if (!parsed.settings) {
            res.status(400).json({ message: parsed.error });
            return;
        }

        try {
            const nightMode = await updateTabletNightModeSettings(prisma, parsed.settings);
            const activeDevices = await prisma.deviceList.findMany({
                where: { status: 'ACTIVE' }
            });

            let delivered = 0;
            for (const device of activeDevices) {
                delivered += sendTabletCommandToDevice(
                    device.deviceId,
                    buildDeviceCommand(device, 'admin-night-mode-settings-updated', nightMode, {
                        fallbackType: 'config-updated',
                        hardReload: false
                    })
                );
            }

            res.status(200).json({
                message: 'Zapisano ustawienia trybu nocnego tabletów.',
                nightMode,
                delivered,
                connectedClients: getConnectedTabletCount(),
                updatedDevices: activeDevices.length
            });
        } catch (error) {
            console.error('Error updating display settings:', error);
            res.status(500).json({
                message: 'Nie udało się zapisać ustawień trybu nocnego tabletów.'
            });
        }
    }

    // POST /api/devices
    static async createDevice(req: Request, res: Response) {
        const { deviceName, deviceClassroom, deviceModel, macAddress, deviceId } = req.body;

        // Generate device URL from name and classroom
        const urlSource = `${deviceName}_${deviceClassroom.toUpperCase()}`;
        const deviceURL = Buffer.from(urlSource).toString('base64');

        // Extract Metadata
        const ipAddress = (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress;
        const userAgent = req.headers['user-agent'];

        console.log("DEBUG: createDevice called");
        console.log("Headers:", JSON.stringify(req.headers, null, 2));
        console.log("Body:", JSON.stringify(req.body, null, 2));
        console.log("Extracted IP:", ipAddress);
        console.log("Extracted UA:", userAgent);

        // Fallback: try to extract model from User-Agent if not provided
        let finalDeviceModel = deviceModel;
        if (!finalDeviceModel && userAgent) {
            // Simple regex to catch Android model in parens, e.g. (Linux; Android 10; SM-A202F)
            const match = userAgent.match(/\((.*?)\)/);
            if (match && match[1]) {
                finalDeviceModel = match[1];
            }
        }

        const device = await prisma.deviceList.create({
            data: {
                deviceId,
                deviceName,
                deviceClassroom: deviceClassroom.toUpperCase(),
                deviceURL,
                deviceModel: finalDeviceModel,
                macAddress,
                ipAddress,
                userAgent
            }
        });

        // 201 Created
        // Successfully created
        res.status(201).json(device);
    }

    // PUT /api/devices/{id}
    static async updateDevice(req: Request, res: Response) {
        const id = parseInt(req.params.id);
        const { id: bodyId, ...data } = req.body;

        if (bodyId && bodyId !== id) {
            res.sendStatus(400);
            return;
        }

        try {
            const current = await prisma.deviceList.findUnique({ where: { id } });
            if (!current) {
                res.sendStatus(404);
                return;
            }

            if (typeof data.deviceClassroom === 'string') {
                data.deviceClassroom = data.deviceClassroom.toUpperCase();
            }

            const nextDeviceName = typeof data.deviceName === 'string' ? data.deviceName : current.deviceName;
            const nextClassroom = typeof data.deviceClassroom === 'string' ? data.deviceClassroom : current.deviceClassroom;

            if (nextDeviceName && nextClassroom) {
                const shouldRegenerateSecret =
                    current.status === 'PENDING' ||
                    current.deviceName !== nextDeviceName ||
                    current.deviceClassroom !== nextClassroom ||
                    !current.deviceURL;

                if (shouldRegenerateSecret) {
                    const urlSource = `${nextDeviceName}_${nextClassroom}`;
                    data.deviceURL = Buffer.from(urlSource).toString('base64');
                }

                if (current.status === 'PENDING') {
                    data.status = 'ACTIVE';
                }
            }

            const updatedDevice = await prisma.deviceList.update({
                where: { id },
                data
            });

            const configChanged =
                current.status !== updatedDevice.status ||
                current.deviceClassroom !== updatedDevice.deviceClassroom ||
                current.deviceURL !== updatedDevice.deviceURL;

            if (configChanged) {
                const reason = current.status === 'PENDING'
                    ? 'device-activated'
                    : 'device-config-updated';
                const nightMode = await getTabletNightModeSettings(prisma);

                sendTabletCommandToDevice(
                    updatedDevice.deviceId,
                    buildDeviceCommand(updatedDevice, reason, nightMode, {
                        fallbackType: 'config-updated',
                        hardReload: true
                    })
                );
            }

            res.sendStatus(204);
        } catch (e) {
            const exists = await prisma.deviceList.findUnique({ where: { id } });
            if (!exists) {
                res.sendStatus(404);
                return;
            }
            throw e;
        }
    }

    // DELETE /api/devices/{id}
    static async deleteDevice(req: Request, res: Response) {
        const id = parseInt(req.params.id);
        try {
            const current = await prisma.deviceList.findUnique({ where: { id } });
            if (!current) {
                res.sendStatus(404);
                return;
            }

            await prisma.deviceList.delete({ where: { id } });
            const nightMode = await getTabletNightModeSettings(prisma);
            sendTabletCommandToDevice(
                current.deviceId,
                {
                    type: 'registry-reset',
                    issuedAt: new Date().toISOString(),
                    hardReload: true,
                    reason: 'device-deleted',
                    path: '/registry',
                    config: {
                        status: 'PENDING',
                        room: null,
                        secretUrl: null,
                        nightMode
                    }
                }
            );
            res.sendStatus(204);
        } catch (e) {
            // Handle error if device doesn't exist
            res.sendStatus(404);
            return;
        }
    }

    // POST /api/devices/reload-all
    static async reloadAllTablets(req: Request, res: Response) {
        const reason = typeof req.body?.reason === 'string'
            ? req.body.reason
            : 'admin-broadcast-reload';

        const delivered = broadcastTabletCommand({
            type: 'reload',
            issuedAt: new Date().toISOString(),
            hardReload: true,
            reason
        });

        res.status(200).json({
            message: 'Wysłano sygnał przeładowania do podłączonych tabletów.',
            delivered,
            connectedClients: getConnectedTabletCount()
        });
    }

    // POST /api/devices/{id}/reload
    static async reloadDevice(req: Request, res: Response) {
        const id = parseInt(req.params.id);
        const device = await prisma.deviceList.findUnique({ where: { id } });

        if (!device) {
            res.sendStatus(404);
            return;
        }

        const reason = typeof req.body?.reason === 'string'
            ? req.body.reason
            : 'admin-device-reload';
        const nightMode = await getTabletNightModeSettings(prisma);

        const delivered = sendTabletCommandToDevice(
            device.deviceId,
            buildDeviceCommand(device, reason, nightMode, {
                fallbackType: 'reload',
                hardReload: true
            })
        );

        res.status(200).json({
            message: 'Wysłano sygnał przeładowania do urządzenia.',
            delivered,
            deviceId: device.deviceId
        });
    }

    // GET /api/devices/validate?room=...&secretUrl=...
    static async validateRoomAndSecretUrl(req: Request, res: Response) {
        const { room, secretUrl } = req.query;

        const device = await prisma.deviceList.findFirst({
            where: {
                deviceClassroom: String(room),
                deviceURL: String(secretUrl)
            }
        });

        if (!device) {
            return res.status(404).json({ message: "Nie znaleziono urządzenia z podanym room i secretUrl." });
        }

        return res.json({ message: "Urządzenie znalezione.", device });
    }
}
