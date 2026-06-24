import { Request, Response } from 'express';
import { DeviceList, PrismaClient } from '@prisma/client';
import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
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
    createPriorityMessagePreset,
    createPriorityMessageSchedule,
    createPriorityMessageTemplate as createPriorityMessageTemplateRecord,
    DEFAULT_TABLET_PRIORITY_MESSAGE,
    deletePriorityMessagePreset,
    deletePriorityMessageSchedule,
    deletePriorityMessageTemplate as deletePriorityMessageTemplateRecord,
    ensurePriorityMessageTables,
    findPriorityMessageScheduleCollisions,
    getActivePriorityMessageDeviceIdsForTemplate,
    getPriorityMessageSchedule,
    getPriorityMessagesForDeviceIds,
    inferPriorityMessageMediaType,
    listPriorityMessagePresets,
    listPriorityMessageSchedules,
    listPriorityMessageTemplates,
    PriorityMessageMediaType,
    PriorityMessageScheduleTargetType,
    synchronizePriorityMessageAssignments,
    TabletPriorityMessage,
    updatePriorityMessagePreset,
    updatePriorityMessageSchedule,
    updatePriorityMessageTemplate as updatePriorityMessageTemplateRecord
} from '../services/tabletPriorityMessageService';
import { generateDeviceSecret } from '../services/deviceSecretService';
import { getDeviceConnectionStatus } from '../services/deviceStatusService';
import { resolveEffectiveBlackScreen } from '../services/tabletBlackScreenService';
import {
    banTabletIpAddress,
    ensureTabletIpBanStorage,
    normalizeTabletIpAddress
} from '../services/tabletIpBanService';

const prisma = new PrismaClient();
const NIGHT_MODE_TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;
const PENDING_DEVICE_CODE_PATTERN = /^\d{6}$/;
const PRIORITY_MESSAGE_UPLOAD_DIR = path.resolve(process.cwd(), 'uploads', 'priority-messages');
const PRIORITY_MESSAGE_UPLOAD_URL_PREFIX = '/priority-message-uploads';
const PRIORITY_MESSAGE_UPLOAD_MAX_BYTES = 50 * 1024 * 1024;
const ALLOWED_PRIORITY_MESSAGE_MIME_TYPES = new Set([
    'image/gif',
    'image/jpeg',
    'image/png',
    'image/webp'
]);

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

const sanitizePriorityMessageFileName = (value: unknown) => {
    const rawName = typeof value === 'string' ? value : 'komunikat';
    const parsedName = path.parse(rawName);
    const baseName = normalizePriorityMessageName(parsedName.name)
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 64) || 'komunikat';
    const extension = parsedName.ext.toLowerCase();

    return { baseName, extension };
};

const getPriorityMessageUploadExtension = (mimeType: string, fileName: unknown) => {
    const { baseName, extension } = sanitizePriorityMessageFileName(fileName);
    const allowedExtension =
        mimeType === 'image/gif'
            ? '.gif'
            : mimeType === 'image/jpeg'
                ? '.jpg'
                : mimeType === 'image/png'
                    ? '.png'
                    : mimeType === 'image/webp'
                        ? '.webp'
                        : '';

    if (!allowedExtension) {
        return { baseName, extension: '' };
    }

    if (
        (allowedExtension === '.jpg' && (extension === '.jpg' || extension === '.jpeg')) ||
        extension === allowedExtension
    ) {
        return { baseName, extension };
    }

    return { baseName, extension: allowedExtension };
};

const parsePriorityMessageUploadPayload = (
    body: Request['body']
): { upload?: { fileName: string; buffer: Buffer; mediaType: PriorityMessageMediaType }; error?: string } => {
    const mimeType = typeof body?.mimeType === 'string' ? body.mimeType.trim().toLowerCase() : '';
    const contentBase64 =
        typeof body?.contentBase64 === 'string'
            ? body.contentBase64.replace(/^data:[^;]+;base64,/, '')
            : '';

    if (!ALLOWED_PRIORITY_MESSAGE_MIME_TYPES.has(mimeType)) {
        return { error: 'Dozwolone formaty pliku: GIF, JPG, PNG albo WebP.' };
    }

    if (!contentBase64) {
        return { error: 'Brak danych pliku.' };
    }

    const { baseName, extension } = getPriorityMessageUploadExtension(mimeType, body?.fileName);
    if (!extension) {
        return { error: 'Nieobsługiwany format pliku.' };
    }

    const buffer = Buffer.from(contentBase64, 'base64');
    if (buffer.length === 0 || buffer.length > PRIORITY_MESSAGE_UPLOAD_MAX_BYTES) {
        return { error: 'Plik musi mieć od 1 B do 50 MB.' };
    }

    return {
        upload: {
            fileName: `${baseName}-${crypto.randomBytes(5).toString('hex')}${extension}`,
            buffer,
            mediaType: mimeType === 'image/gif' ? 'gif' : 'image'
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

const parsePriorityMessageSchedulePayload = (
    body: Request['body']
): {
    schedule?: {
        templateId: string;
        priority: number;
        targetType: PriorityMessageScheduleTargetType;
        facultyCode: string | null;
        deviceIds: number[];
        startsAt: Date;
        endsAt: Date;
        confirmCollisions: boolean;
    };
    error?: string;
} => {
    const templateId = typeof body?.templateId === 'string' ? body.templateId.trim() : '';
    const priority = Number(body?.priority);
    const targetType =
        body?.targetType === 'faculty' || body?.targetType === 'devices'
            ? body.targetType
            : null;
    const startsAt = new Date(body?.startsAt);
    const endsAt = new Date(body?.endsAt);
    const confirmCollisions = body?.confirmCollisions === true;

    if (!templateId || templateId.length > 80) {
        return { error: 'Wybierz komunikat priorytetowy.' };
    }

    if (!Number.isInteger(priority) || priority < 1 || priority > 10) {
        return { error: 'Priorytet musi być liczbą całkowitą od 1 do 10.' };
    }

    if (!targetType) {
        return { error: 'Wybierz odbiorców: tablety albo wydział.' };
    }

    if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime())) {
        return { error: 'Podaj poprawną datę i godzinę rozpoczęcia oraz zakończenia.' };
    }

    if (endsAt <= startsAt) {
        return { error: 'Data zakończenia musi być późniejsza niż data rozpoczęcia.' };
    }

    if (endsAt <= new Date()) {
        return { error: 'Data zakończenia musi przypadać w przyszłości.' };
    }

    if (targetType === 'devices') {
        const parsedDevices = parsePriorityMessageDeviceIds(body);
        if (!parsedDevices.deviceIds) {
            return { error: parsedDevices.error };
        }

        return {
            schedule: {
                templateId,
                priority,
                targetType,
                facultyCode: null,
                deviceIds: parsedDevices.deviceIds,
                startsAt,
                endsAt,
                confirmCollisions
            }
        };
    }

    const facultyCode =
        typeof body?.facultyCode === 'string'
            ? body.facultyCode.trim().replace(/\s+/g, ' ').toUpperCase()
            : '';
    if (!facultyCode || facultyCode.length > 32) {
        return { error: 'Wybierz poprawny wydział.' };
    }

    return {
        schedule: {
            templateId,
            priority,
            targetType,
            facultyCode,
            deviceIds: [],
            startsAt,
            endsAt,
            confirmCollisions
        }
    };
};

const parsePriorityMessagePresetPayload = (
    body: Request['body']
): {
    preset?: {
        name: string;
        templateId: string;
        priority: number;
        startOffsetDays: number;
        durationDays: number;
    };
    error?: string;
} => {
    const name = normalizePriorityMessageName(body?.name);
    const templateId = typeof body?.templateId === 'string' ? body.templateId.trim() : '';
    const priority = Number(body?.priority);
    const startOffsetDays = Number(body?.startOffsetDays);
    const durationDays = Number(body?.durationDays);

    if (!name || name.length > 120) {
        return { error: 'Nazwa presetu jest wymagana i nie może przekraczać 120 znaków.' };
    }
    if (!templateId || templateId.length > 80) {
        return { error: 'Wybierz komunikat dla presetu.' };
    }
    if (!Number.isInteger(priority) || priority < 1 || priority > 10) {
        return { error: 'Priorytet presetu musi być liczbą całkowitą od 1 do 10.' };
    }
    if (!Number.isInteger(startOffsetDays) || startOffsetDays < 0 || startOffsetDays > 3) {
        return { error: 'Początek presetu musi przypadać od dziś do maksymalnie 3 dni.' };
    }
    if (!Number.isInteger(durationDays) || durationDays < 1 || durationDays > 3) {
        return { error: 'Czas trwania presetu musi wynosić od 1 do 3 dni.' };
    }

    return {
        preset: {
            name,
            templateId,
            priority,
            startOffsetDays,
            durationDays
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

const notifyPriorityMessageDevices = async (
    deviceIds: number[],
    reason: string,
    fallbackPriorityMessage?: TabletPriorityMessage
) => {
    const nightMode = await getTabletNightModeSettings(prisma);

    if (deviceIds.length === 0) {
        return { delivered: 0, devices: [] as DeviceList[], nightMode };
    }

    const devices = await prisma.deviceList.findMany({
        where: {
            id: {
                in: deviceIds
            }
        }
    });
    const priorityMessages = fallbackPriorityMessage
        ? new Map<number, TabletPriorityMessage>()
        : await getPriorityMessagesForDeviceIds(prisma, deviceIds);

    let delivered = 0;
    for (const device of devices) {
        delivered += sendTabletCommandToDevice(
            device.deviceId,
            buildDeviceCommand(
                device,
                reason,
                nightMode,
                fallbackPriorityMessage ??
                    priorityMessages.get(device.id) ??
                    DEFAULT_TABLET_PRIORITY_MESSAGE,
                {
                    fallbackType: 'reload',
                    hardReload: true
                }
            )
        );
    }

    return { delivered, devices, nightMode };
};

export class DeviceListController {

    // GET /api/devices
    static async getDevices(req: Request, res: Response) {
        await ensureDeviceListDisplaySettingsColumns(prisma);
        await ensureTabletIpBanStorage(prisma);
        await ensurePriorityMessageTables(prisma);
        await synchronizePriorityMessageAssignments(prisma);
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
        await ensureTabletIpBanStorage(prisma);
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
        await ensureTabletIpBanStorage(prisma);
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

    // POST /api/devices/priority-messages/upload
    static async uploadPriorityMessageMedia(req: AuthRequest, res: Response) {
        const parsed = parsePriorityMessageUploadPayload(req.body);

        if (!parsed.upload) {
            res.status(400).json({ message: parsed.error });
            return;
        }

        try {
            await fs.mkdir(PRIORITY_MESSAGE_UPLOAD_DIR, { recursive: true });
            const targetPath = path.join(PRIORITY_MESSAGE_UPLOAD_DIR, parsed.upload.fileName);
            await fs.writeFile(targetPath, parsed.upload.buffer, { flag: 'wx' });

            res.status(201).json({
                imageUrl: `${PRIORITY_MESSAGE_UPLOAD_URL_PREFIX}/${parsed.upload.fileName}`,
                mediaType: parsed.upload.mediaType
            });
        } catch (error) {
            console.error('Error uploading priority message media:', error);
            res.status(500).json({
                message: 'Nie udało się wgrać pliku komunikatu priorytetowego.'
            });
        }
    }

    // PATCH /api/devices/priority-messages/templates/:templateId
    static async updatePriorityMessageTemplate(req: AuthRequest, res: Response) {
        const templateId = typeof req.params.templateId === 'string' ? req.params.templateId.trim() : '';
        const parsed = parsePriorityMessageTemplatePayload(req.body);

        if (!templateId || templateId.length > 80) {
            res.status(400).json({ message: 'Nieprawidłowy identyfikator komunikatu.' });
            return;
        }

        if (!parsed.template) {
            res.status(400).json({ message: parsed.error });
            return;
        }

        try {
            const activeDeviceIds = await getActivePriorityMessageDeviceIdsForTemplate(
                prisma,
                templateId
            );
            const template = await updatePriorityMessageTemplateRecord(
                prisma,
                templateId,
                parsed.template
            );

            if (!template) {
                res.status(404).json({
                    message: 'Nie znaleziono edytowalnego komunikatu priorytetowego.'
                });
                return;
            }

            const { delivered, devices, nightMode } = await notifyPriorityMessageDevices(
                activeDeviceIds,
                'admin-priority-message-template-updated'
            );
            const priorityMessages = await getPriorityMessagesForDeviceIds(prisma, activeDeviceIds);
            const templates = await listPriorityMessageTemplates(prisma);

            res.status(200).json({
                message: 'Zapisano komunikat priorytetowy.',
                template,
                templates,
                delivered,
                devices: await Promise.all(
                    devices.map((device) =>
                        serializeDevice(
                            device,
                            nightMode,
                            priorityMessages.get(device.id) ?? DEFAULT_TABLET_PRIORITY_MESSAGE
                        )
                    )
                )
            });
        } catch (error) {
            console.error('Error updating priority message template:', error);
            res.status(500).json({
                message: 'Nie udało się zapisać komunikatu priorytetowego.'
            });
        }
    }

    // DELETE /api/devices/priority-messages/templates/:templateId
    static async deletePriorityMessageTemplate(req: AuthRequest, res: Response) {
        const templateId = typeof req.params.templateId === 'string' ? req.params.templateId.trim() : '';

        if (!templateId || templateId.length > 80) {
            res.status(400).json({ message: 'Nieprawidłowy identyfikator komunikatu.' });
            return;
        }

        try {
            const result = await deletePriorityMessageTemplateRecord(prisma, templateId);

            if (!result.deleted) {
                res.status(404).json({
                    message: 'Nie znaleziono edytowalnego komunikatu priorytetowego.'
                });
                return;
            }

            const synchronization = await synchronizePriorityMessageAssignments(prisma);
            const changedDeviceIds = Array.from(
                new Set([
                    ...result.deactivatedDeviceIds,
                    ...synchronization.changedDeviceIds
                ])
            );
            const { delivered, devices, nightMode } = await notifyPriorityMessageDevices(
                changedDeviceIds,
                'admin-priority-message-template-deleted'
            );
            const priorityMessages = await getPriorityMessagesForDeviceIds(
                prisma,
                changedDeviceIds
            );
            const templates = await listPriorityMessageTemplates(prisma);

            res.status(200).json({
                message: 'Usunięto komunikat priorytetowy.',
                templates,
                delivered,
                devices: await Promise.all(
                    devices.map((device) =>
                        serializeDevice(
                            device,
                            nightMode,
                            priorityMessages.get(device.id) ?? DEFAULT_TABLET_PRIORITY_MESSAGE
                        )
                    )
                )
            });
        } catch (error) {
            console.error('Error deleting priority message template:', error);
            res.status(500).json({
                message: 'Nie udało się usunąć komunikatu priorytetowego.'
            });
        }
    }

    // GET /api/devices/priority-messages/schedules
    static async getPriorityMessageSchedules(req: Request, res: Response) {
        try {
            const synchronization = await synchronizePriorityMessageAssignments(prisma);
            if (synchronization.changedDeviceIds.length > 0) {
                await notifyPriorityMessageDevices(
                    synchronization.changedDeviceIds,
                    'priority-message-schedule-synchronized'
                );
            }

            res.status(200).json({
                schedules: await listPriorityMessageSchedules(prisma)
            });
        } catch (error) {
            console.error('Error fetching priority message schedules:', error);
            res.status(500).json({
                message: 'Nie udało się pobrać harmonogramu komunikatów.'
            });
        }
    }

    // POST /api/devices/priority-messages/schedules
    static async createPriorityMessageSchedule(req: AuthRequest, res: Response) {
        const parsed = parsePriorityMessageSchedulePayload(req.body);
        if (!parsed.schedule) {
            res.status(400).json({ message: parsed.error });
            return;
        }

        try {
            const templates = await listPriorityMessageTemplates(prisma);
            if (!templates.some((template) => template.id === parsed.schedule?.templateId)) {
                res.status(400).json({ message: 'Wybrana definicja komunikatu nie istnieje.' });
                return;
            }

            const collisions = await findPriorityMessageScheduleCollisions(prisma, parsed.schedule);
            if (collisions.length > 0 && !parsed.schedule.confirmCollisions) {
                res.status(409).json({
                    message: 'Wykryto kolizję z innymi komunikatami.',
                    requiresConfirmation: true,
                    collisions
                });
                return;
            }

            const schedule = await createPriorityMessageSchedule(prisma, {
                ...parsed.schedule,
                updatedBy: req.user?.login ?? null
            });
            const synchronization = await synchronizePriorityMessageAssignments(prisma);
            const notification = await notifyPriorityMessageDevices(
                synchronization.changedDeviceIds,
                'priority-message-schedule-created'
            );

            res.status(201).json({
                message: 'Zaplanowano komunikat priorytetowy.',
                schedule,
                collisions,
                delivered: notification.delivered
            });
        } catch (error) {
            console.error('Error creating priority message schedule:', error);
            res.status(500).json({
                message: 'Nie udało się zaplanować komunikatu priorytetowego.'
            });
        }
    }

    // PATCH /api/devices/priority-messages/schedules/:scheduleId
    static async updatePriorityMessageSchedule(req: AuthRequest, res: Response) {
        const scheduleId = req.params.scheduleId?.trim();
        const parsed = parsePriorityMessageSchedulePayload(req.body);
        if (!scheduleId || scheduleId.length > 64) {
            res.status(400).json({ message: 'Nieprawidłowy identyfikator harmonogramu.' });
            return;
        }
        if (!parsed.schedule) {
            res.status(400).json({ message: parsed.error });
            return;
        }

        try {
            const current = await getPriorityMessageSchedule(prisma, scheduleId);
            if (!current) {
                res.status(404).json({ message: 'Nie znaleziono harmonogramu komunikatu.' });
                return;
            }

            const templates = await listPriorityMessageTemplates(prisma);
            if (!templates.some((template) => template.id === parsed.schedule?.templateId)) {
                res.status(400).json({ message: 'Wybrana definicja komunikatu nie istnieje.' });
                return;
            }

            const collisions = await findPriorityMessageScheduleCollisions(prisma, {
                ...parsed.schedule,
                scheduleId
            });
            if (collisions.length > 0 && !parsed.schedule.confirmCollisions) {
                res.status(409).json({
                    message: 'Wykryto kolizję z innymi komunikatami.',
                    requiresConfirmation: true,
                    collisions
                });
                return;
            }

            const schedule = await updatePriorityMessageSchedule(prisma, scheduleId, {
                ...parsed.schedule,
                updatedBy: req.user?.login ?? null
            });
            const synchronization = await synchronizePriorityMessageAssignments(prisma);
            const notification = await notifyPriorityMessageDevices(
                synchronization.changedDeviceIds,
                'priority-message-schedule-updated'
            );

            res.status(200).json({
                message: 'Zapisano harmonogram komunikatu.',
                schedule,
                collisions,
                delivered: notification.delivered
            });
        } catch (error) {
            console.error('Error updating priority message schedule:', error);
            res.status(500).json({
                message: 'Nie udało się zapisać harmonogramu komunikatu.'
            });
        }
    }

    // DELETE /api/devices/priority-messages/schedules/:scheduleId
    static async deletePriorityMessageSchedule(req: AuthRequest, res: Response) {
        const scheduleId = req.params.scheduleId?.trim();
        if (!scheduleId || scheduleId.length > 64) {
            res.status(400).json({ message: 'Nieprawidłowy identyfikator harmonogramu.' });
            return;
        }

        try {
            const deleted = await deletePriorityMessageSchedule(prisma, scheduleId);
            if (!deleted) {
                res.status(404).json({ message: 'Nie znaleziono harmonogramu komunikatu.' });
                return;
            }

            const synchronization = await synchronizePriorityMessageAssignments(prisma);
            const notification = await notifyPriorityMessageDevices(
                synchronization.changedDeviceIds,
                'priority-message-schedule-deleted'
            );

            res.status(200).json({
                message: 'Usunięto harmonogram komunikatu.',
                delivered: notification.delivered
            });
        } catch (error) {
            console.error('Error deleting priority message schedule:', error);
            res.status(500).json({
                message: 'Nie udało się usunąć harmonogramu komunikatu.'
            });
        }
    }

    // GET /api/devices/priority-messages/presets
    static async getPriorityMessagePresets(req: Request, res: Response) {
        try {
            res.status(200).json({
                presets: await listPriorityMessagePresets(prisma)
            });
        } catch (error) {
            console.error('Error fetching priority message presets:', error);
            res.status(500).json({
                message: 'Nie udało się pobrać presetów komunikatów.'
            });
        }
    }

    // POST /api/devices/priority-messages/presets
    static async createPriorityMessagePreset(req: AuthRequest, res: Response) {
        const parsed = parsePriorityMessagePresetPayload(req.body);
        if (!parsed.preset) {
            res.status(400).json({ message: parsed.error });
            return;
        }

        try {
            const templates = await listPriorityMessageTemplates(prisma);
            if (!templates.some((template) => template.id === parsed.preset?.templateId)) {
                res.status(400).json({ message: 'Wybrany komunikat nie istnieje.' });
                return;
            }

            const preset = await createPriorityMessagePreset(prisma, {
                ...parsed.preset,
                updatedBy: req.user?.login ?? null
            });
            res.status(201).json({
                message: 'Dodano preset komunikatu.',
                preset,
                presets: await listPriorityMessagePresets(prisma)
            });
        } catch (error) {
            console.error('Error creating priority message preset:', error);
            res.status(500).json({
                message: 'Nie udało się dodać presetu komunikatu.'
            });
        }
    }

    // PATCH /api/devices/priority-messages/presets/:presetId
    static async updatePriorityMessagePreset(req: AuthRequest, res: Response) {
        const presetId = req.params.presetId?.trim();
        const parsed = parsePriorityMessagePresetPayload(req.body);
        if (!presetId || presetId.length > 64) {
            res.status(400).json({ message: 'Nieprawidłowy identyfikator presetu.' });
            return;
        }
        if (!parsed.preset) {
            res.status(400).json({ message: parsed.error });
            return;
        }

        try {
            const templates = await listPriorityMessageTemplates(prisma);
            if (!templates.some((template) => template.id === parsed.preset?.templateId)) {
                res.status(400).json({ message: 'Wybrany komunikat nie istnieje.' });
                return;
            }

            const preset = await updatePriorityMessagePreset(prisma, presetId, {
                ...parsed.preset,
                updatedBy: req.user?.login ?? null
            });
            if (!preset) {
                res.status(404).json({ message: 'Nie znaleziono presetu komunikatu.' });
                return;
            }

            res.status(200).json({
                message: 'Zapisano preset komunikatu.',
                preset,
                presets: await listPriorityMessagePresets(prisma)
            });
        } catch (error) {
            console.error('Error updating priority message preset:', error);
            res.status(500).json({
                message: 'Nie udało się zapisać presetu komunikatu.'
            });
        }
    }

    // DELETE /api/devices/priority-messages/presets/:presetId
    static async deletePriorityMessagePreset(req: AuthRequest, res: Response) {
        const presetId = req.params.presetId?.trim();
        if (!presetId || presetId.length > 64) {
            res.status(400).json({ message: 'Nieprawidłowy identyfikator presetu.' });
            return;
        }

        try {
            const deleted = await deletePriorityMessagePreset(prisma, presetId);
            if (!deleted) {
                res.status(404).json({ message: 'Nie znaleziono presetu komunikatu.' });
                return;
            }

            res.status(200).json({
                message: 'Usunięto preset komunikatu.',
                presets: await listPriorityMessagePresets(prisma)
            });
        } catch (error) {
            console.error('Error deleting priority message preset:', error);
            res.status(500).json({
                message: 'Nie udało się usunąć presetu komunikatu.'
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
                            fallbackType: 'reload',
                            hardReload: true
                        }
                    )
                );
            }
            console.info(
                `[PriorityMessage] Activated: templateId=${parsed.templateId} ` +
                `requested=${parsed.deviceIds.length} updated=${updatedDevices.length} ` +
                `delivered=${delivered} deviceIds=${updatedDevices.map((device) => device.deviceId).join(',')}`
            );

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
            const priorityMessages = await getPriorityMessagesForDeviceIds(
                prisma,
                updatedDeviceIds
            );

            let delivered = 0;
            for (const device of updatedDevices) {
                const priorityMessage =
                    priorityMessages.get(device.id) ?? DEFAULT_TABLET_PRIORITY_MESSAGE;
                delivered += sendTabletCommandToDevice(
                    device.deviceId,
                    buildDeviceCommand(
                        device,
                        'admin-priority-message-cleared',
                        nightMode,
                        priorityMessage,
                        {
                            fallbackType: 'reload',
                            hardReload: true
                        }
                    )
                );
            }
            console.info(
                `[PriorityMessage] Cleared: requested=${parsed.deviceIds.length} ` +
                `updated=${updatedDevices.length} delivered=${delivered} ` +
                `deviceIds=${updatedDevices.map((device) => device.deviceId).join(',')}`
            );

            res.status(200).json({
                message: 'Wyłączono komunikat priorytetowy na wybranych tabletach.',
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
            await synchronizePriorityMessageAssignments(prisma, [updatedDevice.id]);

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
        await ensureTabletIpBanStorage(prisma);
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

    // POST /api/devices/{id}/ban-ip
    static async banDeviceIp(req: AuthRequest, res: Response) {
        await ensureDeviceListDisplaySettingsColumns(prisma);
        await ensureTabletIpBanStorage(prisma);
        const id = parseInt(req.params.id);

        const device = await prisma.deviceList.findUnique({ where: { id } });
        if (!device) {
            res.sendStatus(404);
            return;
        }

        const ipAddress = normalizeTabletIpAddress(device.lastIpAddress);
        if (!ipAddress || ipAddress === 'unknown') {
            res.status(400).json({
                message: 'Tablet nie ma zapisanego poprawnego adresu IP.'
            });
            return;
        }

        try {
            const ban = await banTabletIpAddress(prisma, {
                ipAddress,
                deviceId: device.deviceId,
                reason: typeof req.body?.reason === 'string' ? req.body.reason : null,
                createdBy: req.user?.login ?? null
            });

            await prisma.deviceList.delete({ where: { id } });
            const nightMode = await getTabletNightModeSettings(prisma);
            sendTabletCommandToDevice(device.deviceId, {
                type: 'registry-reset',
                issuedAt: new Date().toISOString(),
                hardReload: true,
                reason: 'device-ip-banned',
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
            });

            res.status(200).json({
                message: 'Zbanowano IP tabletu i usunięto go z kolejki.',
                ban,
                deviceId: device.deviceId,
                ipAddress
            });
        } catch (error) {
            console.error('Error banning tablet IP:', error);
            res.status(500).json({
                message: 'Nie udało się zbanować IP tabletu.'
            });
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
