import { Request, Response } from 'express';
import { DeviceList, PrismaClient } from '@prisma/client';
import { AuthRequest } from '../middlewares/authMiddleware';
import {
    buildTabletPath,
    getConnectedTabletCount,
    sendTabletCommandToDevice,
    TabletCommand,
    TabletDeviceConfig
} from '../services/tabletStreamService';
import {
    DEFAULT_TABLET_EMERGENCY_ALERT_SETTINGS,
    getTabletEmergencyAlertSettings,
    getTabletNightModeSettings,
    TabletEmergencyAlertSettings,
    TabletNightModeSettings,
    updateTabletEmergencyAlertSettings,
    updateTabletNightModeSettings
} from '../services/tabletDisplaySettingsService';
import {
    DeviceDisplaySettings,
    DEFAULT_DEVICE_DISPLAY_SETTINGS,
    ensureDeviceListDisplaySettingsColumns,
    isDeviceBlackScreenMode,
    isTabletDisplayTheme,
    serializeDeviceDisplaySettings
} from '../services/deviceDisplaySettingsService';
import { generateDeviceSecret } from '../services/deviceSecretService';
import { getDeviceConnectionStatus } from '../services/deviceStatusService';
import { resolveEffectiveBlackScreen } from '../services/tabletBlackScreenService';

const prisma = new PrismaClient();
const NIGHT_MODE_TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;
const PENDING_DEVICE_CODE_PATTERN = /^\d{6}$/;

const toTabletConfig = (
    device: DeviceList,
    nightMode: TabletNightModeSettings,
    emergencyAlert: TabletEmergencyAlertSettings
): TabletDeviceConfig => {
    const displaySettings = serializeDeviceDisplaySettings(device);

    return {
        status: device.status,
        room: device.deviceClassroom,
        secretUrl: device.deviceURL,
        nightMode,
        displayTheme: displaySettings.displayTheme,
        blackScreenMode: displaySettings.blackScreenMode,
        emergencyAlert
    };
};

const isValidNightModeTime = (value: string) => NIGHT_MODE_TIME_PATTERN.test(value);

const normalizePendingDeviceCode = (value: unknown) => {
    if (typeof value !== 'string') {
        return '';
    }

    return value.replace(/\s+/g, '').trim();
};

const serializeDevice = async (
    device: DeviceList,
    nightMode: TabletNightModeSettings
) => {
    const connectionStatus = getDeviceConnectionStatus(device);
    const displaySettings = serializeDeviceDisplaySettings(device);
    const blackScreenState = await resolveEffectiveBlackScreen({
        room: device.deviceClassroom,
        nightMode,
        blackScreenMode: displaySettings.blackScreenMode
    });

    return {
        ...device,
        displayTheme: displaySettings.displayTheme,
        blackScreenMode: displaySettings.blackScreenMode,
        ...blackScreenState,
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

const normalizeEmergencyMessage = (value: unknown, fallback: string) =>
    typeof value === 'string' && value.trim()
        ? value.trim().replace(/\s+/g, ' ')
        : fallback;

const parseEmergencyAlertSettingsPayload = (
    body: Request['body']
): {
    settings?: Pick<TabletEmergencyAlertSettings, 'enabled' | 'audioEnabled' | 'messagePl' | 'messageEn'>;
    error?: string;
} => {
    const enabled = typeof body?.enabled === 'boolean' ? body.enabled : null;
    const audioEnabled = typeof body?.audioEnabled === 'boolean' ? body.audioEnabled : null;
    const messagePl = normalizeEmergencyMessage(
        body?.messagePl,
        DEFAULT_TABLET_EMERGENCY_ALERT_SETTINGS.messagePl
    );
    const messageEn = normalizeEmergencyMessage(
        body?.messageEn,
        DEFAULT_TABLET_EMERGENCY_ALERT_SETTINGS.messageEn
    );

    if (enabled === null) {
        return { error: 'Pole enabled musi być wartością logiczną.' };
    }

    if (audioEnabled === null) {
        return { error: 'Pole audioEnabled musi być wartością logiczną.' };
    }

    if (messagePl.length > 500 || messageEn.length > 500) {
        return { error: 'Komunikaty ewakuacyjne nie mogą przekraczać 500 znaków.' };
    }

    return {
        settings: {
            enabled,
            audioEnabled,
            messagePl,
            messageEn
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

    if (body && Object.prototype.hasOwnProperty.call(body, 'blackScreenMode')) {
        if (!isDeviceBlackScreenMode(body.blackScreenMode)) {
            return {
                error: 'Pole blackScreenMode musi mieć wartość follow, on albo off.'
            };
        }

        settings.blackScreenMode = body.blackScreenMode;
    }

    if (Object.keys(settings).length === 0) {
        return {
            error: 'Przekaż co najmniej jedno pole: displayTheme lub blackScreenMode.'
        };
    }

    return { settings };
};

const parseBatchDeviceDisplaySettingsPayload = (
    body: Request['body']
): { deviceIds?: number[]; settings?: Partial<DeviceDisplaySettings>; error?: string } => {
    if (!Array.isArray(body?.deviceIds) || body.deviceIds.length === 0) {
        return { error: 'Pole deviceIds musi zawierać co najmniej jedno id.' };
    }

    const normalizedDeviceIds = body.deviceIds
        .map((value: unknown) => Number(value))
        .filter((value: number) => Number.isInteger(value) && value > 0);

    const deviceIds = Array.from(new Set<number>(normalizedDeviceIds));

    if (deviceIds.length === 0) {
        return { error: 'Pole deviceIds musi zawierać poprawne numery urządzeń.' };
    }

    const settings: Partial<DeviceDisplaySettings> = {};

    if (body && Object.prototype.hasOwnProperty.call(body, 'displayTheme')) {
        if (!isTabletDisplayTheme(body.displayTheme)) {
            return { error: 'Pole displayTheme musi mieć wartość light albo dark.' };
        }

        settings.displayTheme = body.displayTheme;
    }

    if (body && Object.prototype.hasOwnProperty.call(body, 'blackScreenMode')) {
        if (!isDeviceBlackScreenMode(body.blackScreenMode)) {
            return {
                error: 'Pole blackScreenMode musi mieć wartość follow, on albo off.'
            };
        }

        settings.blackScreenMode = body.blackScreenMode;
    }

    if (Object.keys(settings).length === 0) {
        return {
            error: 'Przekaż co najmniej jedno pole: displayTheme lub blackScreenMode.'
        };
    }

    return { deviceIds, settings };
};

const buildDeviceCommand = (
    device: DeviceList,
    reason: string,
    nightMode: TabletNightModeSettings,
    emergencyAlert: TabletEmergencyAlertSettings,
    options?: {
        fallbackType?: Extract<TabletCommand['type'], 'reload' | 'registry-reset' | 'config-updated'>;
        hardReload?: boolean;
    }
): TabletCommand => {
    const fallbackType = options?.fallbackType ?? 'config-updated';
    const hardReload = options?.hardReload ?? true;
    const issuedAt = new Date().toISOString();
    const config = toTabletConfig(device, nightMode, emergencyAlert);

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
        const nightMode = await getTabletNightModeSettings(prisma);
        res.json(await Promise.all(devices.map((device) => serializeDevice(device, nightMode))));
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
        const nightMode = await getTabletNightModeSettings(prisma);
        res.json(await serializeDevice(device, nightMode));
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

        const nightMode = await getTabletNightModeSettings(prisma);
        res.status(200).json(await serializeDevice(device, nightMode));
    }

    // GET /api/devices/display-settings
    static async getDisplaySettings(req: Request, res: Response) {
        try {
            const nightMode = await getTabletNightModeSettings(prisma);
            const emergencyAlert = await getTabletEmergencyAlertSettings(prisma);
            res.json({ nightMode, emergencyAlert });
        } catch (error) {
            console.error('Error fetching display settings:', error);
            res.status(500).json({
                message: 'Nie udało się pobrać ustawień tabletów.'
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
            const emergencyAlert = await getTabletEmergencyAlertSettings(prisma);
            const activeDevices = await prisma.deviceList.findMany({
                where: { status: 'ACTIVE' }
            });

            let delivered = 0;
            for (const device of activeDevices) {
                delivered += sendTabletCommandToDevice(
                    device.deviceId,
                    buildDeviceCommand(device, 'admin-night-mode-settings-updated', nightMode, emergencyAlert, {
                        fallbackType: 'config-updated',
                        hardReload: false
                    })
                );
            }

            res.status(200).json({
                message: 'Zapisano ustawienia trybu nocnego tabletów.',
                nightMode,
                emergencyAlert,
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

    // PUT /api/devices/emergency-alert
    static async updateEmergencyAlert(req: AuthRequest, res: Response) {
        const parsed = parseEmergencyAlertSettingsPayload(req.body);

        if (!parsed.settings) {
            res.status(400).json({ message: parsed.error });
            return;
        }

        try {
            await ensureDeviceListDisplaySettingsColumns(prisma);
            const emergencyAlert = await updateTabletEmergencyAlertSettings(
                prisma,
                parsed.settings,
                req.user?.login ?? null
            );
            const nightMode = await getTabletNightModeSettings(prisma);
            const activeDevices = await prisma.deviceList.findMany({
                where: { status: 'ACTIVE' }
            });

            let delivered = 0;
            for (const device of activeDevices) {
                delivered += sendTabletCommandToDevice(
                    device.deviceId,
                    buildDeviceCommand(device, 'admin-emergency-alert-updated', nightMode, emergencyAlert, {
                        fallbackType: 'config-updated',
                        hardReload: false
                    })
                );
            }

            res.status(200).json({
                message: emergencyAlert.enabled
                    ? 'Włączono alarm ewakuacyjny tabletów.'
                    : 'Wyłączono alarm ewakuacyjny tabletów.',
                nightMode,
                emergencyAlert,
                delivered,
                connectedClients: getConnectedTabletCount(),
                updatedDevices: activeDevices.length
            });
        } catch (error) {
            console.error('Error updating emergency alert settings:', error);
            res.status(500).json({
                message: 'Nie udało się zapisać ustawień alarmu ewakuacyjnego.'
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
        const emergencyAlert = await getTabletEmergencyAlertSettings(prisma);
        const delivered = sendTabletCommandToDevice(
            updatedDevice.deviceId,
            buildDeviceCommand(updatedDevice, 'admin-device-display-settings-updated', nightMode, emergencyAlert, {
                fallbackType: 'config-updated',
                hardReload: false
            })
        );

        res.status(200).json({
            message: 'Zapisano ustawienia wyświetlania tabletu.',
            delivered,
            device: await serializeDevice(updatedDevice, nightMode)
        });
    }

    // PATCH /api/devices/display-settings/batch
    static async batchUpdateDeviceDisplaySettings(req: Request, res: Response) {
        const parsed = parseBatchDeviceDisplaySettingsPayload(req.body);

        if (!parsed.deviceIds || !parsed.settings) {
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
            data: parsed.settings
        });

        const updatedDevices = await prisma.deviceList.findMany({
            where: {
                id: {
                    in: parsed.deviceIds
                }
            }
        });

        const nightMode = await getTabletNightModeSettings(prisma);
        const emergencyAlert = await getTabletEmergencyAlertSettings(prisma);
        let delivered = 0;

        for (const device of updatedDevices) {
            delivered += sendTabletCommandToDevice(
                device.deviceId,
                buildDeviceCommand(device, 'admin-batch-device-display-settings-updated', nightMode, emergencyAlert, {
                    fallbackType: 'config-updated',
                    hardReload: false
                })
            );
        }

        res.status(200).json({
            message: 'Zapisano ustawienia wyświetlania dla wybranych tabletów.',
            delivered,
            updatedCount: updatedDevices.length,
            devices: await Promise.all(
                updatedDevices.map((device) => serializeDevice(device, nightMode))
            )
        });
    }

    // POST /api/devices
    static async createDevice(req: Request, res: Response) {
        await ensureDeviceListDisplaySettingsColumns(prisma);
        const { deviceClassroom, macAddress, deviceId } = req.body;

        const device = await prisma.deviceList.create({
            data: {
                deviceId,
                deviceClassroom: deviceClassroom.toUpperCase(),
                deviceURL: generateDeviceSecret(),
                macAddress
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

            const nextClassroom = typeof data.deviceClassroom === 'string' ? data.deviceClassroom : current.deviceClassroom;

            if (nextClassroom) {
                if (current.status === 'PENDING') {
                    data.status = 'ACTIVE';
                }

                if (!current.deviceURL) {
                    data.deviceURL = generateDeviceSecret();
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
                const emergencyAlert = await getTabletEmergencyAlertSettings(prisma);

                sendTabletCommandToDevice(
                    updatedDevice.deviceId,
                    buildDeviceCommand(updatedDevice, reason, nightMode, emergencyAlert, {
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
            const emergencyAlert = await getTabletEmergencyAlertSettings(prisma);
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
                        blackScreenMode: DEFAULT_DEVICE_DISPLAY_SETTINGS.blackScreenMode,
                        emergencyAlert
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
        await ensureDeviceListDisplaySettingsColumns(prisma);
        const reason = typeof req.body?.reason === 'string'
            ? req.body.reason
            : 'admin-broadcast-reload';
        const nightMode = await getTabletNightModeSettings(prisma);
        const emergencyAlert = await getTabletEmergencyAlertSettings(prisma);
        const devices = await prisma.deviceList.findMany();

        let delivered = 0;
        for (const device of devices) {
            delivered += sendTabletCommandToDevice(
                device.deviceId,
                buildDeviceCommand(device, reason, nightMode, emergencyAlert, {
                    fallbackType: 'reload',
                    hardReload: true
                })
            );
        }

        res.status(200).json({
            message: 'Wysłano sygnał przeładowania do wszystkich znanych tabletów.',
            delivered,
            connectedClients: getConnectedTabletCount(),
            targetedDevices: devices.length
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
        const emergencyAlert = await getTabletEmergencyAlertSettings(prisma);

        const delivered = sendTabletCommandToDevice(
            device.deviceId,
            buildDeviceCommand(device, reason, nightMode, emergencyAlert, {
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
