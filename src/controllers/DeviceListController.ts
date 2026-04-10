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
import {
    DeviceDisplaySettings,
    DEFAULT_DEVICE_DISPLAY_SETTINGS,
    ensureDeviceListDisplaySettingsColumns,
    isTabletDisplayTheme,
    serializeDeviceDisplaySettings
} from '../services/deviceDisplaySettingsService';

const prisma = new PrismaClient();
const NIGHT_MODE_TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;
const PENDING_DEVICE_CODE_PATTERN = /^\d{6}$/;
const TABLET_OFFLINE_THRESHOLD_MS = 75 * 1000;

type DeviceConnectionStatus = 'PENDING' | 'ONLINE' | 'OFFLINE';

const toTabletConfig = (
    device: DeviceList,
    nightMode: TabletNightModeSettings
): TabletDeviceConfig => {
    const displaySettings = serializeDeviceDisplaySettings(device);

    return {
        status: device.status,
        room: device.deviceClassroom,
        secretUrl: device.deviceURL,
        nightMode,
        displayTheme: displaySettings.displayTheme,
        forceBlackScreen: displaySettings.forceBlackScreen
    };
};

const isValidNightModeTime = (value: string) => NIGHT_MODE_TIME_PATTERN.test(value);

const normalizePendingDeviceCode = (value: unknown) => {
    if (typeof value !== 'string') {
        return '';
    }

    return value.replace(/\s+/g, '').trim();
};

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
    const displaySettings = serializeDeviceDisplaySettings(device);

    return {
        ...device,
        ...displaySettings,
        connectionStatus,
        isConnected: connectionStatus === 'ONLINE'
    };
};

const parseNightModeSettingsPayload = (
    body: Request['body']
): { settings?: TabletNightModeSettings; error?: string } => {
    const enabled = typeof body?.enabled === 'boolean' ? body.enabled : null;
    const blackScreenAfterScheduleEnd =
        typeof body?.blackScreenAfterScheduleEnd === 'boolean'
            ? body.blackScreenAfterScheduleEnd
            : null;
    const startTime = typeof body?.startTime === 'string' ? body.startTime.trim() : '';
    const endTime = typeof body?.endTime === 'string' ? body.endTime.trim() : '';

    if (enabled === null) {
        return { error: 'Pole enabled musi być wartością logiczną.' };
    }

    if (blackScreenAfterScheduleEnd === null) {
        return {
            error: 'Pole blackScreenAfterScheduleEnd musi być wartością logiczną.'
        };
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
            endTime,
            blackScreenAfterScheduleEnd
        }
    };
};

const parseDeviceDisplaySettingsPatch = (
    body: Request['body']
): { settings?: Partial<DeviceDisplaySettings>; error?: string } => {
    const settings: Partial<DeviceDisplaySettings> = {};

    if (body && Object.prototype.hasOwnProperty.call(body, 'displayTheme')) {
        if (!isTabletDisplayTheme(body.displayTheme)) {
            return { error: 'Pole displayTheme musi mieć wartość light albo dark.' };
        }

        settings.displayTheme = body.displayTheme;
    }

    if (body && Object.prototype.hasOwnProperty.call(body, 'forceBlackScreen')) {
        if (typeof body.forceBlackScreen !== 'boolean') {
            return { error: 'Pole forceBlackScreen musi być wartością logiczną.' };
        }

        settings.forceBlackScreen = body.forceBlackScreen;
    }

    if (Object.keys(settings).length === 0) {
        return {
            error: 'Przekaż co najmniej jedno pole: displayTheme lub forceBlackScreen.'
        };
    }

    return { settings };
};

const parseBatchDeviceDisplaySettingsPayload = (
    body: Request['body']
): { deviceIds?: number[]; displayTheme?: DeviceDisplaySettings['displayTheme']; error?: string } => {
    if (!Array.isArray(body?.deviceIds) || body.deviceIds.length === 0) {
        return { error: 'Pole deviceIds musi zawierać co najmniej jedno id.' };
    }

    if (!isTabletDisplayTheme(body.displayTheme)) {
        return { error: 'Pole displayTheme musi mieć wartość light albo dark.' };
    }

    const normalizedDeviceIds = body.deviceIds
        .map((value: unknown) => Number(value))
        .filter((value: number) => Number.isInteger(value) && value > 0);

    const deviceIds = Array.from(new Set<number>(normalizedDeviceIds));

    if (deviceIds.length === 0) {
        return { error: 'Pole deviceIds musi zawierać poprawne numery urządzeń.' };
    }

    return { deviceIds, displayTheme: body.displayTheme };
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

const buildDisplayProfileRequestCommand = (reason: string): TabletCommand => ({
    type: 'report-display-profile',
    issuedAt: new Date().toISOString(),
    reason
});

export class DeviceListController {

    // GET /api/devices
    static async getDevices(req: Request, res: Response) {
        await ensureDeviceListDisplaySettingsColumns(prisma);
        const devices = await prisma.deviceList.findMany();
        res.json(devices.map(serializeDevice));
    }

    // GET /api/devices/{id}
    static async getDevice(req: Request, res: Response) {
        await ensureDeviceListDisplaySettingsColumns(prisma);
        const id = parseInt(req.params.id);
        const device = await prisma.deviceList.findUnique({ where: { id } });
        if (!device) {
            res.sendStatus(404);
            return;
        }
        res.json(serializeDevice(device));
    }

    // GET /api/devices/pending/by-code?deviceId=123456
    static async getPendingDeviceByCode(req: Request, res: Response) {
        await ensureDeviceListDisplaySettingsColumns(prisma);
        const deviceId = normalizePendingDeviceCode(req.query.deviceId);

        if (!PENDING_DEVICE_CODE_PATTERN.test(deviceId)) {
            res.status(400).json({
                message: 'Kod tabletu musi składać się z dokładnie 6 cyfr.'
            });
            return;
        }

        const device = await prisma.deviceList.findFirst({
            where: {
                deviceId,
                status: 'PENDING'
            }
        });

        if (!device) {
            res.status(404).json({
                message: 'Nie znaleziono tabletu oczekującego na rejestrację z tym kodem.'
            });
            return;
        }

        res.status(200).json(serializeDevice(device));
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
            await ensureDeviceListDisplaySettingsColumns(prisma);
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

    // PATCH /api/devices/{id}/display-settings
    static async updateDeviceDisplaySettings(req: Request, res: Response) {
        const id = parseInt(req.params.id);
        const parsed = parseDeviceDisplaySettingsPatch(req.body);

        if (!parsed.settings) {
            res.status(400).json({ message: parsed.error });
            return;
        }

        await ensureDeviceListDisplaySettingsColumns(prisma);

        const current = await prisma.deviceList.findUnique({ where: { id } });
        if (!current) {
            res.sendStatus(404);
            return;
        }

        const updatedDevice = await prisma.deviceList.update({
            where: { id },
            data: parsed.settings
        });

        const nightMode = await getTabletNightModeSettings(prisma);
        const delivered = sendTabletCommandToDevice(
            updatedDevice.deviceId,
            buildDeviceCommand(updatedDevice, 'admin-device-display-settings-updated', nightMode, {
                fallbackType: 'config-updated',
                hardReload: false
            })
        );

        res.status(200).json({
            message: 'Zapisano ustawienia wyświetlania tabletu.',
            delivered,
            device: serializeDevice(updatedDevice)
        });
    }

    // PATCH /api/devices/display-settings/batch
    static async batchUpdateDeviceDisplaySettings(req: Request, res: Response) {
        const parsed = parseBatchDeviceDisplaySettingsPayload(req.body);

        if (!parsed.deviceIds || !parsed.displayTheme) {
            res.status(400).json({ message: parsed.error });
            return;
        }

        await ensureDeviceListDisplaySettingsColumns(prisma);

        await prisma.deviceList.updateMany({
            where: {
                id: {
                    in: parsed.deviceIds
                }
            },
            data: {
                displayTheme: parsed.displayTheme
            }
        });

        const updatedDevices = await prisma.deviceList.findMany({
            where: {
                id: {
                    in: parsed.deviceIds
                }
            }
        });

        const nightMode = await getTabletNightModeSettings(prisma);
        let delivered = 0;

        for (const device of updatedDevices) {
            delivered += sendTabletCommandToDevice(
                device.deviceId,
                buildDeviceCommand(device, 'admin-batch-device-theme-updated', nightMode, {
                    fallbackType: 'config-updated',
                    hardReload: false
                })
            );
        }

        res.status(200).json({
            message: 'Zapisano ustawienia wyświetlania dla wybranych tabletów.',
            delivered,
            updatedCount: updatedDevices.length,
            devices: updatedDevices.map(serializeDevice)
        });
    }

    // POST /api/devices
    static async createDevice(req: Request, res: Response) {
        await ensureDeviceListDisplaySettingsColumns(prisma);
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
        await ensureDeviceListDisplaySettingsColumns(prisma);
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
        await ensureDeviceListDisplaySettingsColumns(prisma);
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
                        nightMode,
                        displayTheme: DEFAULT_DEVICE_DISPLAY_SETTINGS.displayTheme,
                        forceBlackScreen: DEFAULT_DEVICE_DISPLAY_SETTINGS.forceBlackScreen
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
        await ensureDeviceListDisplaySettingsColumns(prisma);
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

    // POST /api/devices/{id}/request-display-profile
    static async requestDisplayProfile(req: Request, res: Response) {
        await ensureDeviceListDisplaySettingsColumns(prisma);
        const id = parseInt(req.params.id);
        const device = await prisma.deviceList.findUnique({ where: { id } });

        if (!device) {
            res.sendStatus(404);
            return;
        }

        const delivered = sendTabletCommandToDevice(
            device.deviceId,
            buildDisplayProfileRequestCommand('admin-request-display-profile')
        );

        res.status(200).json({
            message:
                delivered > 0
                    ? 'Wysłano prośbę o raport profilu ekranu.'
                    : 'Urządzenie nie jest aktualnie połączone.',
            delivered,
            deviceId: device.deviceId
        });
    }

    // GET /api/devices/validate?room=...&secretUrl=...
    static async validateRoomAndSecretUrl(req: Request, res: Response) {
        await ensureDeviceListDisplaySettingsColumns(prisma);
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
