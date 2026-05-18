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
    getTabletNightModeSettings,
    TabletNightModeSettings,
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
import {
    activatePriorityMessageForDevices,
    clearPriorityMessageForDevices,
    createPriorityMessageTemplate as createPriorityMessageTemplateRecord,
    DEFAULT_TABLET_PRIORITY_MESSAGE,
    ensurePriorityMessageTables,
    getPriorityMessagesForDeviceIds,
    inferPriorityMessageMediaType,
    listPriorityMessageTemplates,
    PriorityMessageMediaType,
    TabletPriorityMessage
} from '../services/tabletPriorityMessageService';
import { generateDeviceSecret } from '../services/deviceSecretService';
import { getDeviceConnectionStatus } from '../services/deviceStatusService';
import { resolveEffectiveBlackScreen } from '../services/tabletBlackScreenService';

const prisma = new PrismaClient();
const NIGHT_MODE_TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;
const PENDING_DEVICE_CODE_PATTERN = /^\d{6}$/;

const toTabletConfig = (
    device: DeviceList,
    nightMode: TabletNightModeSettings,
    priorityMessage: TabletPriorityMessage
): TabletDeviceConfig => {
    const displaySettings = serializeDeviceDisplaySettings(device);

    return {
        status: device.status,
        room: device.deviceClassroom,
        secretUrl: device.deviceURL,
        nightMode,
        displayTheme: displaySettings.displayTheme,
        blackScreenMode: displaySettings.blackScreenMode,
        priorityMessage
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
    nightMode: TabletNightModeSettings,
    priorityMessage: TabletPriorityMessage = DEFAULT_TABLET_PRIORITY_MESSAGE
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
        isConnected: connectionStatus === 'ONLINE',
        priorityMessage
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

const normalizePriorityMessageName = (value: unknown) =>
    typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';

const normalizePriorityMessageUrl = (value: unknown) =>
    typeof value === 'string' ? value.trim() : '';

const isAllowedPriorityMessageUrl = (value: string) =>
    value.startsWith('/') || value.startsWith('https://') || value.startsWith('http://');

const parsePriorityMessageTemplatePayload = (
    body: Request['body']
): {
    template?: { name: string; imageUrl: string; mediaType: PriorityMessageMediaType };
    error?: string;
} => {
    const name = normalizePriorityMessageName(body?.name);
    const imageUrl = normalizePriorityMessageUrl(body?.imageUrl);
    const mediaType =
        body?.mediaType === 'image' || body?.mediaType === 'gif'
            ? body.mediaType
            : inferPriorityMessageMediaType(imageUrl);

    if (!name || name.length > 120) {
        return { error: 'Nazwa komunikatu jest wymagana i nie może przekraczać 120 znaków.' };
    }

    if (!imageUrl || imageUrl.length > 500 || !isAllowedPriorityMessageUrl(imageUrl)) {
        return { error: 'URL obrazka/GIF musi zaczynać się od /, http:// albo https://.' };
    }

    return {
        template: {
            name,
            imageUrl,
            mediaType
        }
    };
};

const parsePriorityMessageDeviceIds = (
    body: Request['body']
): { deviceIds?: number[]; error?: string } => {
    if (!Array.isArray(body?.deviceIds) || body.deviceIds.length === 0) {
        return { error: 'Pole deviceIds musi zawierać co najmniej jedno id.' };
    }

    const deviceIds = Array.from(
        new Set<number>(
            body.deviceIds
                .map((value: unknown) => Number(value))
                .filter((value: number) => Number.isInteger(value) && value > 0)
        )
    );

    if (deviceIds.length === 0) {
        return { error: 'Pole deviceIds musi zawierać poprawne numery urządzeń.' };
    }

    return { deviceIds };
};

const parsePriorityMessageActivationPayload = (
    body: Request['body']
): { deviceIds?: number[]; templateId?: string; error?: string } => {
    const parsedDevices = parsePriorityMessageDeviceIds(body);
    if (!parsedDevices.deviceIds) {
        return { error: parsedDevices.error };
    }

    const templateId = typeof body?.templateId === 'string' ? body.templateId.trim() : '';
    if (!templateId || templateId.length > 80) {
        return { error: 'Wybierz definicję komunikatu priorytetowego.' };
    }

    return {
        deviceIds: parsedDevices.deviceIds,
        templateId
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
    priorityMessage: TabletPriorityMessage,
    options?: {
        fallbackType?: Extract<TabletCommand['type'], 'reload' | 'registry-reset' | 'config-updated'>;
        hardReload?: boolean;
    }
): TabletCommand => {
    const fallbackType = options?.fallbackType ?? 'config-updated';
    const hardReload = options?.hardReload ?? true;
    const issuedAt = new Date().toISOString();
    const config = toTabletConfig(device, nightMode, priorityMessage);

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
        await ensurePriorityMessageTables(prisma);
        const devices = await prisma.deviceList.findMany();
        const nightMode = await getTabletNightModeSettings(prisma);
        const priorityMessages = await getPriorityMessagesForDeviceIds(
            prisma,
            devices.map((device) => device.id)
        );
        res.json(await Promise.all(devices.map((device) =>
            serializeDevice(
                device,
                nightMode,
                priorityMessages.get(device.id) ?? DEFAULT_TABLET_PRIORITY_MESSAGE
            )
        )));
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
        const priorityMessages = await getPriorityMessagesForDeviceIds(prisma, [device.id]);
        res.json(await serializeDevice(
            device,
            nightMode,
            priorityMessages.get(device.id) ?? DEFAULT_TABLET_PRIORITY_MESSAGE
        ));
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
            res.json({ nightMode });
        } catch (error) {
            console.error('Error fetching display settings:', error);
            res.status(500).json({
                message: 'Nie udało się pobrać ustawień tabletów.'
            });
        }
    }

    // GET /api/devices/priority-messages
    static async getPriorityMessages(req: Request, res: Response) {
        try {
            const templates = await listPriorityMessageTemplates(prisma);
            res.status(200).json({ templates });
        } catch (error) {
            console.error('Error fetching priority message templates:', error);
            res.status(500).json({
                message: 'Nie udało się pobrać komunikatów priorytetowych.'
            });
        }
    }

    // POST /api/devices/priority-messages/templates
    static async createPriorityMessageTemplate(req: AuthRequest, res: Response) {
        const parsed = parsePriorityMessageTemplatePayload(req.body);

        if (!parsed.template) {
            res.status(400).json({ message: parsed.error });
            return;
        }

        try {
            const template = await createPriorityMessageTemplateRecord(prisma, parsed.template);
            const templates = await listPriorityMessageTemplates(prisma);

            res.status(201).json({
                message: 'Dodano definicję komunikatu priorytetowego.',
                template,
                templates
            });
        } catch (error) {
            console.error('Error creating priority message template:', error);
            res.status(500).json({
                message: 'Nie udało się dodać komunikatu priorytetowego.'
            });
        }
    }

    // POST /api/devices/priority-messages/activate
    static async activatePriorityMessage(req: AuthRequest, res: Response) {
        const parsed = parsePriorityMessageActivationPayload(req.body);

        if (!parsed.deviceIds || !parsed.templateId) {
            res.status(400).json({ message: parsed.error });
            return;
        }

        try {
            const templates = await listPriorityMessageTemplates(prisma);
            if (!templates.some((template) => template.id === parsed.templateId)) {
                res.status(400).json({ message: 'Wybrana definicja komunikatu nie istnieje.' });
                return;
            }

            const updatedDeviceIds = await activatePriorityMessageForDevices(prisma, {
                deviceIds: parsed.deviceIds,
                templateId: parsed.templateId,
                updatedBy: req.user?.login ?? null
            });

            const updatedDevices = await prisma.deviceList.findMany({
                where: {
                    id: {
                        in: updatedDeviceIds
                    }
                }
            });
            const nightMode = await getTabletNightModeSettings(prisma);
            const priorityMessages = await getPriorityMessagesForDeviceIds(prisma, updatedDeviceIds);

            let delivered = 0;
            for (const device of updatedDevices) {
                delivered += sendTabletCommandToDevice(
                    device.deviceId,
                    buildDeviceCommand(
                        device,
                        'admin-priority-message-activated',
                        nightMode,
                        priorityMessages.get(device.id) ?? DEFAULT_TABLET_PRIORITY_MESSAGE,
                        {
                            fallbackType: 'config-updated',
                            hardReload: false
                        }
                    )
                );
            }

            res.status(200).json({
                message: 'Włączono komunikat priorytetowy na wybranych tabletach.',
                delivered,
                updatedCount: updatedDevices.length,
                devices: await Promise.all(
                    updatedDevices.map((device) =>
                        serializeDevice(
                            device,
                            nightMode,
                            priorityMessages.get(device.id) ?? DEFAULT_TABLET_PRIORITY_MESSAGE
                        )
                    )
                )
            });
        } catch (error) {
            console.error('Error activating priority message:', error);
            res.status(500).json({
                message: 'Nie udało się włączyć komunikatu priorytetowego.'
            });
        }
    }

    // POST /api/devices/priority-messages/clear
    static async clearPriorityMessage(req: AuthRequest, res: Response) {
        const parsed = parsePriorityMessageDeviceIds(req.body);

        if (!parsed.deviceIds) {
            res.status(400).json({ message: parsed.error });
            return;
        }

        try {
            const updatedDeviceIds = await clearPriorityMessageForDevices(prisma, {
                deviceIds: parsed.deviceIds,
                updatedBy: req.user?.login ?? null
            });

            const updatedDevices = await prisma.deviceList.findMany({
                where: {
                    id: {
                        in: updatedDeviceIds
                    }
                }
            });
            const nightMode = await getTabletNightModeSettings(prisma);

            let delivered = 0;
            for (const device of updatedDevices) {
                delivered += sendTabletCommandToDevice(
                    device.deviceId,
                    buildDeviceCommand(
                        device,
                        'admin-priority-message-cleared',
                        nightMode,
                        DEFAULT_TABLET_PRIORITY_MESSAGE,
                        {
                            fallbackType: 'config-updated',
                            hardReload: false
                        }
                    )
                );
            }

            res.status(200).json({
                message: 'Wyłączono komunikat priorytetowy na wybranych tabletach.',
                delivered,
                updatedCount: updatedDevices.length,
                devices: await Promise.all(
                    updatedDevices.map((device) =>
                        serializeDevice(device, nightMode, DEFAULT_TABLET_PRIORITY_MESSAGE)
                    )
                )
            });
        } catch (error) {
            console.error('Error clearing priority message:', error);
            res.status(500).json({
                message: 'Nie udało się wyłączyć komunikatu priorytetowego.'
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
            const priorityMessages = await getPriorityMessagesForDeviceIds(
                prisma,
                activeDevices.map((device) => device.id)
            );

            let delivered = 0;
            for (const device of activeDevices) {
                delivered += sendTabletCommandToDevice(
                    device.deviceId,
                    buildDeviceCommand(
                        device,
                        'admin-night-mode-settings-updated',
                        nightMode,
                        priorityMessages.get(device.id) ?? DEFAULT_TABLET_PRIORITY_MESSAGE,
                        {
                            fallbackType: 'config-updated',
                            hardReload: false
                        }
                    )
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
        const priorityMessages = await getPriorityMessagesForDeviceIds(prisma, [updatedDevice.id]);
        const delivered = sendTabletCommandToDevice(
            updatedDevice.deviceId,
            buildDeviceCommand(
                updatedDevice,
                'admin-device-display-settings-updated',
                nightMode,
                priorityMessages.get(updatedDevice.id) ?? DEFAULT_TABLET_PRIORITY_MESSAGE,
                {
                    fallbackType: 'config-updated',
                    hardReload: false
                }
            )
        );

        res.status(200).json({
            message: 'Zapisano ustawienia wyświetlania tabletu.',
            delivered,
            device: await serializeDevice(
                updatedDevice,
                nightMode,
                priorityMessages.get(updatedDevice.id) ?? DEFAULT_TABLET_PRIORITY_MESSAGE
            )
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
        const priorityMessages = await getPriorityMessagesForDeviceIds(
            prisma,
            updatedDevices.map((device) => device.id)
        );
        let delivered = 0;

        for (const device of updatedDevices) {
            delivered += sendTabletCommandToDevice(
                device.deviceId,
                buildDeviceCommand(
                    device,
                    'admin-batch-device-display-settings-updated',
                    nightMode,
                    priorityMessages.get(device.id) ?? DEFAULT_TABLET_PRIORITY_MESSAGE,
                    {
                        fallbackType: 'config-updated',
                        hardReload: false
                    }
                )
            );
        }

        res.status(200).json({
            message: 'Zapisano ustawienia wyświetlania dla wybranych tabletów.',
            delivered,
            updatedCount: updatedDevices.length,
            devices: await Promise.all(
                updatedDevices.map((device) =>
                    serializeDevice(
                        device,
                        nightMode,
                        priorityMessages.get(device.id) ?? DEFAULT_TABLET_PRIORITY_MESSAGE
                    )
                )
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
                const priorityMessages = await getPriorityMessagesForDeviceIds(prisma, [updatedDevice.id]);

                sendTabletCommandToDevice(
                    updatedDevice.deviceId,
                    buildDeviceCommand(
                        updatedDevice,
                        reason,
                        nightMode,
                        priorityMessages.get(updatedDevice.id) ?? DEFAULT_TABLET_PRIORITY_MESSAGE,
                        {
                            fallbackType: 'config-updated',
                            hardReload: true
                        }
                    )
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
                        blackScreenMode: DEFAULT_DEVICE_DISPLAY_SETTINGS.blackScreenMode,
                        priorityMessage: DEFAULT_TABLET_PRIORITY_MESSAGE
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
        const devices = await prisma.deviceList.findMany();
        const priorityMessages = await getPriorityMessagesForDeviceIds(
            prisma,
            devices.map((device) => device.id)
        );

        let delivered = 0;
        for (const device of devices) {
            delivered += sendTabletCommandToDevice(
                device.deviceId,
                buildDeviceCommand(
                    device,
                    reason,
                    nightMode,
                    priorityMessages.get(device.id) ?? DEFAULT_TABLET_PRIORITY_MESSAGE,
                    {
                        fallbackType: 'reload',
                        hardReload: true
                    }
                )
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
        const priorityMessages = await getPriorityMessagesForDeviceIds(prisma, [device.id]);

        const delivered = sendTabletCommandToDevice(
            device.deviceId,
            buildDeviceCommand(
                device,
                reason,
                nightMode,
                priorityMessages.get(device.id) ?? DEFAULT_TABLET_PRIORITY_MESSAGE,
                {
                    fallbackType: 'reload',
                    hardReload: true
                }
            )
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
