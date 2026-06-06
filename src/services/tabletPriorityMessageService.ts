import { PrismaClient } from '@prisma/client';
import crypto from 'crypto';

const PRIORITY_MESSAGE_TEMPLATES_TABLE = 'tablet_priority_message_templates';
const PRIORITY_MESSAGE_ASSIGNMENTS_TABLE = 'tablet_priority_message_assignments';
const PRIORITY_MESSAGE_MANUAL_ASSIGNMENTS_TABLE = 'tablet_priority_message_manual_assignments';
const PRIORITY_MESSAGE_SCHEDULES_TABLE = 'tablet_priority_message_schedules';
const PRIORITY_MESSAGE_SCHEDULE_TARGETS_TABLE = 'tablet_priority_message_schedule_targets';
const PRIORITY_MESSAGE_PRESETS_TABLE = 'tablet_priority_message_presets';
const PRIORITY_MESSAGE_PRESET_SEED_STATE_TABLE =
    'tablet_priority_message_preset_seed_state';
const DEVICE_LIST_TABLE = '"DeviceList"';
const MANUAL_PRIORITY = 11;

export type PriorityMessageMediaType = 'image' | 'gif';

export interface PriorityMessageTemplate {
    id: string;
    name: string;
    imageUrl: string;
    mediaType: PriorityMessageMediaType;
    isBuiltin: boolean;
    createdAt: Date | null;
    updatedAt: Date | null;
}

export interface TabletPriorityMessage {
    enabled: boolean;
    template: PriorityMessageTemplate | null;
    updatedAt: Date | null;
    updatedBy: string | null;
    priority: number | null;
}

export type PriorityMessageScheduleTargetType = 'devices' | 'faculty';
export type PriorityMessageScheduleStatus = 'scheduled' | 'active';

export interface PriorityMessageScheduleDevice {
    id: number;
    deviceId: string;
    room: string | null;
    facultyCode: string | null;
}

export interface PriorityMessageSchedule {
    id: string;
    template: PriorityMessageTemplate;
    priority: number;
    targetType: PriorityMessageScheduleTargetType;
    facultyCode: string | null;
    deviceIds: number[];
    devices: PriorityMessageScheduleDevice[];
    startsAt: Date;
    endsAt: Date;
    createdBy: string | null;
    createdAt: Date;
    updatedAt: Date;
    status: PriorityMessageScheduleStatus;
}

export interface PriorityMessageScheduleCollision {
    scheduleId: string;
    templateName: string;
    priority: number;
    startsAt: Date;
    endsAt: Date;
    deviceIds: number[];
    winnerScheduleId: string;
}

export interface PriorityMessagePreset {
    id: string;
    name: string;
    template: PriorityMessageTemplate;
    priority: number;
    startOffsetDays: number;
    durationDays: number;
    createdBy: string | null;
    createdAt: Date;
    updatedAt: Date;
}

interface PriorityMessageTemplateRow {
    id: string;
    name: string;
    image_url: string;
    media_type: string;
    is_builtin: boolean;
    created_at: Date | null;
    updated_at: Date | null;
}

interface PriorityMessageAssignmentRow extends PriorityMessageTemplateRow {
    device_id: number;
    active: boolean;
    assignment_updated_at: Date | null;
    updated_by: string | null;
    priority: number | null;
}

interface PriorityMessageScheduleRow extends PriorityMessageTemplateRow {
    schedule_id: string;
    priority: number;
    target_type: string;
    faculty_code: string | null;
    starts_at: Date;
    ends_at: Date;
    created_by: string | null;
    schedule_created_at: Date;
    schedule_updated_at: Date;
}

interface PriorityMessageScheduleTargetRow {
    schedule_id: string;
    device_id: number;
}

interface PriorityMessageDeviceRow {
    id: number;
    device_id: string;
    device_classroom: string | null;
}

interface PriorityMessagePresetRow extends PriorityMessageTemplateRow {
    preset_id: string;
    preset_name: string;
    priority: number;
    duration_mode: string;
    start_offset_days: number;
    duration_days: number;
    created_by: string | null;
    preset_created_at: Date;
    preset_updated_at: Date;
}

export const DEFAULT_TABLET_PRIORITY_MESSAGE: TabletPriorityMessage = {
    enabled: false,
    template: null,
    updatedAt: null,
    updatedBy: null,
    priority: null
};

const BUILTIN_PRIORITY_MESSAGE_TEMPLATES: Array<{
    id: string;
    name: string;
    imageUrl: string;
    mediaType: PriorityMessageMediaType;
    sortOrder: number;
}> = [
    {
        id: 'evac',
        name: 'EVAC.gif',
        imageUrl: '/priority-messages/EVAC.gif',
        mediaType: 'gif',
        sortOrder: 10
    },
    {
        id: 'dzien_rektorski',
        name: 'dzien_rektorski.jpg',
        imageUrl: '/priority-messages/dzien_rektorski.jpg',
        mediaType: 'image',
        sortOrder: 20
    }
];

const mapTemplateRow = (row: PriorityMessageTemplateRow): PriorityMessageTemplate => ({
    id: row.id,
    name: row.name,
    imageUrl: row.image_url,
    mediaType: row.media_type === 'gif' ? 'gif' : 'image',
    isBuiltin: row.is_builtin,
    createdAt: row.created_at,
    updatedAt: row.updated_at
});

const mapAssignmentRow = (row: PriorityMessageAssignmentRow): TabletPriorityMessage => ({
    enabled: row.active,
    template: row.active ? mapTemplateRow(row) : null,
    updatedAt: row.assignment_updated_at,
    updatedBy: row.updated_by,
    priority: row.active ? row.priority : null
});

const normalizeTemplateId = (value: string) =>
    value
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 60);

export const inferPriorityMessageMediaType = (imageUrl: string): PriorityMessageMediaType =>
    imageUrl.trim().toLowerCase().split('?')[0].endsWith('.gif') ? 'gif' : 'image';

export const ensurePriorityMessageTables = async (prisma: PrismaClient) => {
    await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS ${PRIORITY_MESSAGE_TEMPLATES_TABLE} (
            id VARCHAR(80) PRIMARY KEY,
            name TEXT NOT NULL,
            image_url TEXT NOT NULL,
            media_type VARCHAR(16) NOT NULL DEFAULT 'image',
            is_builtin BOOLEAN NOT NULL DEFAULT FALSE,
            sort_order INTEGER NOT NULL DEFAULT 100,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    `);

    await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS ${PRIORITY_MESSAGE_ASSIGNMENTS_TABLE} (
            device_id INTEGER PRIMARY KEY REFERENCES ${DEVICE_LIST_TABLE}(id) ON DELETE CASCADE,
            template_id VARCHAR(80) NOT NULL REFERENCES ${PRIORITY_MESSAGE_TEMPLATES_TABLE}(id),
            active BOOLEAN NOT NULL DEFAULT TRUE,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_by TEXT
        )
    `);

    await prisma.$executeRawUnsafe(`
        CREATE INDEX IF NOT EXISTS idx_tablet_priority_message_assignments_active
        ON ${PRIORITY_MESSAGE_ASSIGNMENTS_TABLE}(active)
    `);

    await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS ${PRIORITY_MESSAGE_MANUAL_ASSIGNMENTS_TABLE} (
            device_id INTEGER PRIMARY KEY REFERENCES ${DEVICE_LIST_TABLE}(id) ON DELETE CASCADE,
            template_id VARCHAR(80) NOT NULL REFERENCES ${PRIORITY_MESSAGE_TEMPLATES_TABLE}(id) ON DELETE CASCADE,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_by TEXT
        )
    `);

    await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS ${PRIORITY_MESSAGE_SCHEDULES_TABLE} (
            id VARCHAR(64) PRIMARY KEY,
            template_id VARCHAR(80) NOT NULL REFERENCES ${PRIORITY_MESSAGE_TEMPLATES_TABLE}(id) ON DELETE CASCADE,
            priority INTEGER NOT NULL CHECK (priority BETWEEN 1 AND 10),
            target_type VARCHAR(16) NOT NULL CHECK (target_type IN ('devices', 'faculty')),
            faculty_code VARCHAR(32),
            starts_at TIMESTAMPTZ NOT NULL,
            ends_at TIMESTAMPTZ NOT NULL,
            created_by TEXT,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            CHECK (ends_at > starts_at),
            CHECK (
                (target_type = 'faculty' AND faculty_code IS NOT NULL)
                OR (target_type = 'devices' AND faculty_code IS NULL)
            )
        )
    `);

    await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS ${PRIORITY_MESSAGE_SCHEDULE_TARGETS_TABLE} (
            schedule_id VARCHAR(64) NOT NULL REFERENCES ${PRIORITY_MESSAGE_SCHEDULES_TABLE}(id) ON DELETE CASCADE,
            device_id INTEGER NOT NULL REFERENCES ${DEVICE_LIST_TABLE}(id) ON DELETE CASCADE,
            PRIMARY KEY (schedule_id, device_id)
        )
    `);

    await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS ${PRIORITY_MESSAGE_PRESETS_TABLE} (
            id VARCHAR(64) PRIMARY KEY,
            name TEXT NOT NULL,
            template_id VARCHAR(80) NOT NULL REFERENCES ${PRIORITY_MESSAGE_TEMPLATES_TABLE}(id) ON DELETE CASCADE,
            priority INTEGER NOT NULL CHECK (priority BETWEEN 1 AND 10),
            duration_mode VARCHAR(24) NOT NULL CHECK (
                duration_mode IN ('tomorrow', 'end_of_day', 'end_of_week')
            ),
            start_offset_days SMALLINT NOT NULL DEFAULT 0 CHECK (start_offset_days BETWEEN 0 AND 3),
            duration_days SMALLINT NOT NULL DEFAULT 1 CHECK (duration_days BETWEEN 1 AND 3),
            created_by TEXT,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    `);

    await prisma.$executeRawUnsafe(`
        ALTER TABLE ${PRIORITY_MESSAGE_PRESETS_TABLE}
            ADD COLUMN IF NOT EXISTS start_offset_days SMALLINT NOT NULL DEFAULT 0,
            ADD COLUMN IF NOT EXISTS duration_days SMALLINT NOT NULL DEFAULT 1
    `);

    await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS ${PRIORITY_MESSAGE_PRESET_SEED_STATE_TABLE} (
            id SMALLINT PRIMARY KEY CHECK (id = 1),
            seeded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    `);

    await prisma.$executeRawUnsafe(`
        ALTER TABLE ${PRIORITY_MESSAGE_ASSIGNMENTS_TABLE}
            ADD COLUMN IF NOT EXISTS schedule_id VARCHAR(64),
            ADD COLUMN IF NOT EXISTS priority INTEGER,
            ADD COLUMN IF NOT EXISTS source_migrated BOOLEAN NOT NULL DEFAULT FALSE
    `);

    await prisma.$executeRawUnsafe(`
        INSERT INTO ${PRIORITY_MESSAGE_MANUAL_ASSIGNMENTS_TABLE} (
            device_id,
            template_id,
            updated_at,
            updated_by
        )
        SELECT device_id, template_id, updated_at, updated_by
        FROM ${PRIORITY_MESSAGE_ASSIGNMENTS_TABLE}
        WHERE active = TRUE
          AND schedule_id IS NULL
          AND source_migrated = FALSE
        ON CONFLICT (device_id) DO NOTHING
    `);

    await prisma.$executeRawUnsafe(`
        UPDATE ${PRIORITY_MESSAGE_ASSIGNMENTS_TABLE}
        SET source_migrated = TRUE
        WHERE source_migrated = FALSE
    `);

    await prisma.$executeRawUnsafe(`
        CREATE INDEX IF NOT EXISTS idx_tablet_priority_message_schedules_window
        ON ${PRIORITY_MESSAGE_SCHEDULES_TABLE}(starts_at, ends_at)
    `);

    await prisma.$executeRawUnsafe(`
        CREATE INDEX IF NOT EXISTS idx_tablet_priority_message_schedules_faculty
        ON ${PRIORITY_MESSAGE_SCHEDULES_TABLE}(faculty_code)
    `);

    await prisma.$executeRawUnsafe(`
        CREATE INDEX IF NOT EXISTS idx_tablet_priority_message_schedule_targets_device
        ON ${PRIORITY_MESSAGE_SCHEDULE_TARGETS_TABLE}(device_id)
    `);

    for (const template of BUILTIN_PRIORITY_MESSAGE_TEMPLATES) {
        await prisma.$executeRawUnsafe(
            `
                INSERT INTO ${PRIORITY_MESSAGE_TEMPLATES_TABLE} (
                    id,
                    name,
                    image_url,
                    media_type,
                    is_builtin,
                    sort_order,
                    created_at,
                    updated_at
                )
                VALUES ($1, $2, $3, $4, TRUE, $5, NOW(), NOW())
                ON CONFLICT (id) DO UPDATE SET
                    name = EXCLUDED.name,
                    image_url = EXCLUDED.image_url,
                    media_type = EXCLUDED.media_type,
                    is_builtin = TRUE,
                    sort_order = EXCLUDED.sort_order,
                    updated_at = NOW()
            `,
            template.id,
            template.name,
            template.imageUrl,
            template.mediaType,
            template.sortOrder
        );
    }

    const seedRows = await prisma.$queryRawUnsafe<Array<{ id: number }>>(`
        SELECT id
        FROM ${PRIORITY_MESSAGE_PRESET_SEED_STATE_TABLE}
        WHERE id = 1
    `);
    if (seedRows.length === 0) {
        await prisma.$executeRawUnsafe(`
            INSERT INTO ${PRIORITY_MESSAGE_PRESETS_TABLE} (
                id,
                name,
                template_id,
                priority,
                duration_mode,
                start_offset_days,
                duration_days,
                created_at,
                updated_at
            )
            VALUES
                ('preset-evacuation', 'Ewakuacja', 'evac', 10, 'end_of_day', 0, 1, NOW(), NOW()),
                ('preset-rectors-day', 'Dzień rektorski', 'dzien_rektorski', 7, 'tomorrow', 0, 1, NOW(), NOW())
            ON CONFLICT (id) DO NOTHING
        `);
        await prisma.$executeRawUnsafe(`
            INSERT INTO ${PRIORITY_MESSAGE_PRESET_SEED_STATE_TABLE} (id, seeded_at)
            VALUES (1, NOW())
            ON CONFLICT (id) DO NOTHING
        `);
    }
};

export const listPriorityMessageTemplates = async (
    prisma: PrismaClient
): Promise<PriorityMessageTemplate[]> => {
    await ensurePriorityMessageTables(prisma);

    const rows = await prisma.$queryRawUnsafe<PriorityMessageTemplateRow[]>(`
        SELECT id, name, image_url, media_type, is_builtin, created_at, updated_at
        FROM ${PRIORITY_MESSAGE_TEMPLATES_TABLE}
        ORDER BY is_builtin DESC, sort_order ASC, created_at ASC, name ASC
    `);

    return rows.map(mapTemplateRow);
};

export const createPriorityMessageTemplate = async (
    prisma: PrismaClient,
    input: {
        name: string;
        imageUrl: string;
        mediaType?: PriorityMessageMediaType;
    }
): Promise<PriorityMessageTemplate> => {
    await ensurePriorityMessageTables(prisma);

    const baseId = normalizeTemplateId(input.name) || 'komunikat';
    const id = `${baseId}-${Date.now().toString(36)}`;
    const mediaType = input.mediaType ?? inferPriorityMessageMediaType(input.imageUrl);

    const rows = await prisma.$queryRawUnsafe<PriorityMessageTemplateRow[]>(
        `
            INSERT INTO ${PRIORITY_MESSAGE_TEMPLATES_TABLE} (
                id,
                name,
                image_url,
                media_type,
                is_builtin,
                sort_order,
                created_at,
                updated_at
            )
            VALUES ($1, $2, $3, $4, FALSE, 100, NOW(), NOW())
            RETURNING id, name, image_url, media_type, is_builtin, created_at, updated_at
        `,
        id,
        input.name,
        input.imageUrl,
        mediaType
    );

    return mapTemplateRow(rows[0]);
};

export const updatePriorityMessageTemplate = async (
    prisma: PrismaClient,
    templateId: string,
    input: {
        name: string;
        imageUrl: string;
        mediaType?: PriorityMessageMediaType;
    }
): Promise<PriorityMessageTemplate | null> => {
    await ensurePriorityMessageTables(prisma);

    const mediaType = input.mediaType ?? inferPriorityMessageMediaType(input.imageUrl);
    const rows = await prisma.$queryRawUnsafe<PriorityMessageTemplateRow[]>(
        `
            UPDATE ${PRIORITY_MESSAGE_TEMPLATES_TABLE}
            SET name = $2,
                image_url = $3,
                media_type = $4,
                updated_at = NOW()
            WHERE id = $1
              AND is_builtin = FALSE
            RETURNING id, name, image_url, media_type, is_builtin, created_at, updated_at
        `,
        templateId,
        input.name,
        input.imageUrl,
        mediaType
    );

    return rows[0] ? mapTemplateRow(rows[0]) : null;
};

export const deletePriorityMessageTemplate = async (
    prisma: PrismaClient,
    templateId: string
): Promise<{ deleted: boolean; deactivatedDeviceIds: number[] }> => {
    await ensurePriorityMessageTables(prisma);

    return prisma.$transaction(async (transaction) => {
        const templateRows = await transaction.$queryRawUnsafe<Array<{ id: string }>>(
            `
                SELECT id
                FROM ${PRIORITY_MESSAGE_TEMPLATES_TABLE}
                WHERE id = $1
                  AND is_builtin = FALSE
            `,
            templateId
        );

        if (templateRows.length === 0) {
            return { deleted: false, deactivatedDeviceIds: [] };
        }

        const deactivatedRows = await transaction.$queryRawUnsafe<Array<{ device_id: number }>>(
            `
                DELETE FROM ${PRIORITY_MESSAGE_ASSIGNMENTS_TABLE}
                WHERE template_id = $1
                  AND active = TRUE
                RETURNING device_id
            `,
            templateId
        );

        await transaction.$executeRawUnsafe(
            `
                DELETE FROM ${PRIORITY_MESSAGE_ASSIGNMENTS_TABLE}
                WHERE template_id = $1
            `,
            templateId
        );

        await transaction.$executeRawUnsafe(
            `
                DELETE FROM ${PRIORITY_MESSAGE_TEMPLATES_TABLE}
                WHERE id = $1
                  AND is_builtin = FALSE
            `,
            templateId
        );

        return {
            deleted: true,
            deactivatedDeviceIds: deactivatedRows.map((row) => row.device_id)
        };
    });
};

export const getActivePriorityMessageDeviceIdsForTemplate = async (
    prisma: PrismaClient,
    templateId: string
): Promise<number[]> => {
    await ensurePriorityMessageTables(prisma);

    const rows = await prisma.$queryRawUnsafe<Array<{ device_id: number }>>(
        `
            SELECT device_id
            FROM ${PRIORITY_MESSAGE_ASSIGNMENTS_TABLE}
            WHERE template_id = $1
              AND active = TRUE
        `,
        templateId
    );

    return rows.map((row) => row.device_id);
};

export const getPriorityMessagesForDeviceIds = async (
    prisma: PrismaClient,
    deviceIds: number[]
): Promise<Map<number, TabletPriorityMessage>> => {
    await ensurePriorityMessageTables(prisma);

    if (deviceIds.length === 0) {
        return new Map();
    }

    const placeholders = deviceIds.map((_, index) => `$${index + 1}`).join(', ');
    const rows = await prisma.$queryRawUnsafe<PriorityMessageAssignmentRow[]>(
        `
            SELECT
                a.device_id,
                a.active,
                a.updated_at AS assignment_updated_at,
                a.updated_by,
                a.priority,
                t.id,
                t.name,
                t.image_url,
                t.media_type,
                t.is_builtin,
                t.created_at,
                t.updated_at
            FROM ${PRIORITY_MESSAGE_ASSIGNMENTS_TABLE} a
            INNER JOIN ${PRIORITY_MESSAGE_TEMPLATES_TABLE} t ON t.id = a.template_id
            WHERE a.active = TRUE
              AND a.device_id IN (${placeholders})
        `,
        ...deviceIds
    );

    return new Map(rows.map((row) => [row.device_id, mapAssignmentRow(row)]));
};

export const getPriorityMessageForDevice = async (
    prisma: PrismaClient,
    deviceId: number
): Promise<TabletPriorityMessage> => {
    const messages = await getPriorityMessagesForDeviceIds(prisma, [deviceId]);
    return messages.get(deviceId) ?? DEFAULT_TABLET_PRIORITY_MESSAGE;
};

export const activatePriorityMessageForDevices = async (
    prisma: PrismaClient,
    input: {
        deviceIds: number[];
        templateId: string;
        updatedBy: string | null;
    }
) => {
    await ensurePriorityMessageTables(prisma);

    if (input.deviceIds.length === 0) {
        return [];
    }

    const placeholders = input.deviceIds.map((_, index) => `$${index + 1}`).join(', ');
    const templateParam = `$${input.deviceIds.length + 1}`;
    const updatedByParam = `$${input.deviceIds.length + 2}`;

    const rows = await prisma.$queryRawUnsafe<Array<{ device_id: number }>>(
        `
            INSERT INTO ${PRIORITY_MESSAGE_MANUAL_ASSIGNMENTS_TABLE} (
                device_id,
                template_id,
                updated_at,
                updated_by
            )
            SELECT id, ${templateParam}, NOW(), ${updatedByParam}
            FROM ${DEVICE_LIST_TABLE}
            WHERE id IN (${placeholders})
              AND status = 'ACTIVE'
            ON CONFLICT (device_id) DO UPDATE SET
                template_id = EXCLUDED.template_id,
                updated_at = NOW(),
                updated_by = EXCLUDED.updated_by
            RETURNING device_id
        `,
        ...input.deviceIds,
        input.templateId,
        input.updatedBy
    );

    const deviceIds = rows.map((row) => row.device_id);
    await synchronizePriorityMessageAssignments(prisma, deviceIds);
    return deviceIds;
};

export const clearPriorityMessageForDevices = async (
    prisma: PrismaClient,
    input: {
        deviceIds: number[];
        updatedBy: string | null;
    }
) => {
    await ensurePriorityMessageTables(prisma);

    if (input.deviceIds.length === 0) {
        return [];
    }

    const placeholders = input.deviceIds.map((_, index) => `$${index + 1}`).join(', ');

    const rows = await prisma.$queryRawUnsafe<Array<{ device_id: number }>>(
        `
            DELETE FROM ${PRIORITY_MESSAGE_MANUAL_ASSIGNMENTS_TABLE}
            WHERE device_id IN (${placeholders})
            RETURNING device_id
        `,
        ...input.deviceIds
    );

    await synchronizePriorityMessageAssignments(prisma, input.deviceIds);
    return rows.map((row) => row.device_id);
};

const getFacultyCode = (room: string | null) => {
    const normalizedRoom = room?.trim().replace(/\s+/g, ' ') ?? '';
    const separatorIndex = normalizedRoom.indexOf(' ');
    return separatorIndex > 0 ? normalizedRoom.slice(0, separatorIndex).toUpperCase() : null;
};

const listActiveScheduleDevices = async (
    prisma: PrismaClient,
    deviceIds?: number[]
): Promise<PriorityMessageScheduleDevice[]> => {
    const filter =
        deviceIds && deviceIds.length > 0
            ? `AND id IN (${deviceIds.map((_, index) => `$${index + 1}`).join(', ')})`
            : '';
    const rows = await prisma.$queryRawUnsafe<PriorityMessageDeviceRow[]>(
        `
            SELECT
                id,
                "deviceId" AS device_id,
                "deviceClassroom" AS device_classroom
            FROM ${DEVICE_LIST_TABLE}
            WHERE status = 'ACTIVE'
            ${filter}
            ORDER BY "deviceClassroom" ASC, "deviceId" ASC
        `,
        ...(deviceIds ?? [])
    );

    return rows.map((row) => ({
        id: row.id,
        deviceId: row.device_id,
        room: row.device_classroom,
        facultyCode: getFacultyCode(row.device_classroom)
    }));
};

const loadScheduleRows = async (
    prisma: PrismaClient,
    options?: { includeExpired?: boolean }
) => {
    const expiryFilter = options?.includeExpired ? '' : 'WHERE s.ends_at > NOW()';
    return prisma.$queryRawUnsafe<PriorityMessageScheduleRow[]>(`
        SELECT
            s.id AS schedule_id,
            s.priority,
            s.target_type,
            s.faculty_code,
            s.starts_at,
            s.ends_at,
            s.created_by,
            s.created_at AS schedule_created_at,
            s.updated_at AS schedule_updated_at,
            t.id,
            t.name,
            t.image_url,
            t.media_type,
            t.is_builtin,
            t.created_at,
            t.updated_at
        FROM ${PRIORITY_MESSAGE_SCHEDULES_TABLE} s
        INNER JOIN ${PRIORITY_MESSAGE_TEMPLATES_TABLE} t ON t.id = s.template_id
        ${expiryFilter}
        ORDER BY s.starts_at ASC, s.priority DESC, s.updated_at DESC
    `);
};

const buildSchedules = async (
    prisma: PrismaClient,
    rows: PriorityMessageScheduleRow[]
): Promise<PriorityMessageSchedule[]> => {
    if (rows.length === 0) {
        return [];
    }

    const scheduleIds = rows.map((row) => row.schedule_id);
    const targetRows = await prisma.$queryRawUnsafe<PriorityMessageScheduleTargetRow[]>(
        `
            SELECT schedule_id, device_id
            FROM ${PRIORITY_MESSAGE_SCHEDULE_TARGETS_TABLE}
            WHERE schedule_id IN (${scheduleIds.map((_, index) => `$${index + 1}`).join(', ')})
        `,
        ...scheduleIds
    );
    const devices = await listActiveScheduleDevices(prisma);
    const deviceMap = new Map(devices.map((device) => [device.id, device]));
    const targetIdsBySchedule = new Map<string, number[]>();

    for (const target of targetRows) {
        const current = targetIdsBySchedule.get(target.schedule_id) ?? [];
        current.push(target.device_id);
        targetIdsBySchedule.set(target.schedule_id, current);
    }

    const now = Date.now();
    return rows.map((row) => {
        const targetType: PriorityMessageScheduleTargetType =
            row.target_type === 'faculty' ? 'faculty' : 'devices';
        const directDeviceIds = targetIdsBySchedule.get(row.schedule_id) ?? [];
        const resolvedDevices =
            targetType === 'faculty'
                ? devices.filter((device) => device.facultyCode === row.faculty_code)
                : directDeviceIds
                    .map((deviceId) => deviceMap.get(deviceId))
                    .filter((device): device is PriorityMessageScheduleDevice => Boolean(device));

        return {
            id: row.schedule_id,
            template: mapTemplateRow(row),
            priority: row.priority,
            targetType,
            facultyCode: row.faculty_code,
            deviceIds: directDeviceIds,
            devices: resolvedDevices,
            startsAt: row.starts_at,
            endsAt: row.ends_at,
            createdBy: row.created_by,
            createdAt: row.schedule_created_at,
            updatedAt: row.schedule_updated_at,
            status: row.starts_at.getTime() <= now ? 'active' : 'scheduled'
        };
    });
};

export const listPriorityMessageSchedules = async (
    prisma: PrismaClient
): Promise<PriorityMessageSchedule[]> => {
    await ensurePriorityMessageTables(prisma);
    return buildSchedules(prisma, await loadScheduleRows(prisma));
};

export const getPriorityMessageSchedule = async (
    prisma: PrismaClient,
    scheduleId: string
): Promise<PriorityMessageSchedule | null> => {
    await ensurePriorityMessageTables(prisma);
    const rows = await loadScheduleRows(prisma, { includeExpired: true });
    const row = rows.find((candidate) => candidate.schedule_id === scheduleId);
    if (!row) {
        return null;
    }

    return (await buildSchedules(prisma, [row]))[0] ?? null;
};

export const findPriorityMessageScheduleCollisions = async (
    prisma: PrismaClient,
    input: {
        scheduleId?: string;
        priority: number;
        targetType: PriorityMessageScheduleTargetType;
        facultyCode: string | null;
        deviceIds: number[];
        startsAt: Date;
        endsAt: Date;
    }
): Promise<PriorityMessageScheduleCollision[]> => {
    const schedules = await listPriorityMessageSchedules(prisma);
    const devices = await listActiveScheduleDevices(prisma);
    const proposedDeviceIds =
        input.targetType === 'faculty'
            ? devices
                .filter((device) => device.facultyCode === input.facultyCode)
                .map((device) => device.id)
            : input.deviceIds;
    const proposedDeviceIdSet = new Set(proposedDeviceIds);
    const proposedId = input.scheduleId ?? 'proposed';

    return schedules
        .filter((schedule) => schedule.id !== input.scheduleId)
        .filter(
            (schedule) =>
                schedule.startsAt < input.endsAt &&
                schedule.endsAt > input.startsAt
        )
        .map((schedule) => ({
            schedule,
            deviceIds: schedule.devices
                .map((device) => device.id)
                .filter((deviceId) => proposedDeviceIdSet.has(deviceId))
        }))
        .filter(({ deviceIds }) => deviceIds.length > 0)
        .map(({ schedule, deviceIds }) => ({
            scheduleId: schedule.id,
            templateName: schedule.template.name,
            priority: schedule.priority,
            startsAt: schedule.startsAt,
            endsAt: schedule.endsAt,
            deviceIds,
            winnerScheduleId:
                input.priority >= schedule.priority ? proposedId : schedule.id
        }));
};

interface PriorityMessageScheduleMutationInput {
    templateId: string;
    priority: number;
    targetType: PriorityMessageScheduleTargetType;
    facultyCode: string | null;
    deviceIds: number[];
    startsAt: Date;
    endsAt: Date;
    updatedBy: string | null;
}

export const createPriorityMessageSchedule = async (
    prisma: PrismaClient,
    input: PriorityMessageScheduleMutationInput
) => {
    await ensurePriorityMessageTables(prisma);
    const scheduleId = crypto.randomUUID();

    await prisma.$transaction(async (transaction) => {
        await transaction.$executeRawUnsafe(
            `
                INSERT INTO ${PRIORITY_MESSAGE_SCHEDULES_TABLE} (
                    id,
                    template_id,
                    priority,
                    target_type,
                    faculty_code,
                    starts_at,
                    ends_at,
                    created_by,
                    created_at,
                    updated_at
                )
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())
            `,
            scheduleId,
            input.templateId,
            input.priority,
            input.targetType,
            input.facultyCode,
            input.startsAt,
            input.endsAt,
            input.updatedBy
        );

        if (input.targetType === 'devices') {
            for (const deviceId of input.deviceIds) {
                await transaction.$executeRawUnsafe(
                    `
                        INSERT INTO ${PRIORITY_MESSAGE_SCHEDULE_TARGETS_TABLE} (
                            schedule_id,
                            device_id
                        )
                        SELECT $1, id
                        FROM ${DEVICE_LIST_TABLE}
                        WHERE id = $2
                          AND status = 'ACTIVE'
                        ON CONFLICT DO NOTHING
                    `,
                    scheduleId,
                    deviceId
                );
            }
        }
    });

    return getPriorityMessageSchedule(prisma, scheduleId);
};

export const updatePriorityMessageSchedule = async (
    prisma: PrismaClient,
    scheduleId: string,
    input: PriorityMessageScheduleMutationInput
) => {
    await ensurePriorityMessageTables(prisma);

    const updated = await prisma.$transaction(async (transaction) => {
        const rows = await transaction.$queryRawUnsafe<Array<{ id: string }>>(
            `
                UPDATE ${PRIORITY_MESSAGE_SCHEDULES_TABLE}
                SET template_id = $2,
                    priority = $3,
                    target_type = $4,
                    faculty_code = $5,
                    starts_at = $6,
                    ends_at = $7,
                    updated_at = NOW()
                WHERE id = $1
                RETURNING id
            `,
            scheduleId,
            input.templateId,
            input.priority,
            input.targetType,
            input.facultyCode,
            input.startsAt,
            input.endsAt
        );

        if (rows.length === 0) {
            return false;
        }

        await transaction.$executeRawUnsafe(
            `DELETE FROM ${PRIORITY_MESSAGE_SCHEDULE_TARGETS_TABLE} WHERE schedule_id = $1`,
            scheduleId
        );

        if (input.targetType === 'devices') {
            for (const deviceId of input.deviceIds) {
                await transaction.$executeRawUnsafe(
                    `
                        INSERT INTO ${PRIORITY_MESSAGE_SCHEDULE_TARGETS_TABLE} (
                            schedule_id,
                            device_id
                        )
                        SELECT $1, id
                        FROM ${DEVICE_LIST_TABLE}
                        WHERE id = $2
                          AND status = 'ACTIVE'
                        ON CONFLICT DO NOTHING
                    `,
                    scheduleId,
                    deviceId
                );
            }
        }

        return true;
    });

    return updated ? getPriorityMessageSchedule(prisma, scheduleId) : null;
};

export const deletePriorityMessageSchedule = async (
    prisma: PrismaClient,
    scheduleId: string
) => {
    await ensurePriorityMessageTables(prisma);
    const rows = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
        `
            DELETE FROM ${PRIORITY_MESSAGE_SCHEDULES_TABLE}
            WHERE id = $1
            RETURNING id
        `,
        scheduleId
    );
    return rows.length > 0;
};

const mapPresetRow = (row: PriorityMessagePresetRow): PriorityMessagePreset => ({
    id: row.preset_id,
    name: row.preset_name,
    template: mapTemplateRow(row),
    priority: row.priority,
    startOffsetDays: Number(row.start_offset_days),
    durationDays: Number(row.duration_days),
    createdBy: row.created_by,
    createdAt: row.preset_created_at,
    updatedAt: row.preset_updated_at
});

export const listPriorityMessagePresets = async (
    prisma: PrismaClient
): Promise<PriorityMessagePreset[]> => {
    await ensurePriorityMessageTables(prisma);
    const rows = await prisma.$queryRawUnsafe<PriorityMessagePresetRow[]>(`
        SELECT
            p.id AS preset_id,
            p.name AS preset_name,
            p.priority,
            p.duration_mode,
            p.start_offset_days,
            p.duration_days,
            p.created_by,
            p.created_at AS preset_created_at,
            p.updated_at AS preset_updated_at,
            t.id,
            t.name,
            t.image_url,
            t.media_type,
            t.is_builtin,
            t.created_at,
            t.updated_at
        FROM ${PRIORITY_MESSAGE_PRESETS_TABLE} p
        INNER JOIN ${PRIORITY_MESSAGE_TEMPLATES_TABLE} t ON t.id = p.template_id
        ORDER BY p.name ASC, p.created_at ASC
    `);

    return rows.map(mapPresetRow);
};

interface PriorityMessagePresetMutationInput {
    name: string;
    templateId: string;
    priority: number;
    startOffsetDays: number;
    durationDays: number;
    updatedBy: string | null;
}

export const createPriorityMessagePreset = async (
    prisma: PrismaClient,
    input: PriorityMessagePresetMutationInput
) => {
    await ensurePriorityMessageTables(prisma);
    const id = crypto.randomUUID();
    await prisma.$executeRawUnsafe(
        `
            INSERT INTO ${PRIORITY_MESSAGE_PRESETS_TABLE} (
                id,
                name,
                template_id,
                priority,
                duration_mode,
                start_offset_days,
                duration_days,
                created_by,
                created_at,
                updated_at
            )
            VALUES ($1, $2, $3, $4, 'tomorrow', $5, $6, $7, NOW(), NOW())
        `,
        id,
        input.name,
        input.templateId,
        input.priority,
        input.startOffsetDays,
        input.durationDays,
        input.updatedBy
    );

    return (await listPriorityMessagePresets(prisma)).find((preset) => preset.id === id) ?? null;
};

export const updatePriorityMessagePreset = async (
    prisma: PrismaClient,
    presetId: string,
    input: PriorityMessagePresetMutationInput
) => {
    await ensurePriorityMessageTables(prisma);
    const rows = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
        `
            UPDATE ${PRIORITY_MESSAGE_PRESETS_TABLE}
            SET name = $2,
                template_id = $3,
                priority = $4,
                duration_mode = 'tomorrow',
                start_offset_days = $5,
                duration_days = $6,
                updated_at = NOW()
            WHERE id = $1
            RETURNING id
        `,
        presetId,
        input.name,
        input.templateId,
        input.priority,
        input.startOffsetDays,
        input.durationDays
    );
    if (rows.length === 0) {
        return null;
    }

    return (await listPriorityMessagePresets(prisma)).find(
        (preset) => preset.id === presetId
    ) ?? null;
};

export const deletePriorityMessagePreset = async (
    prisma: PrismaClient,
    presetId: string
) => {
    await ensurePriorityMessageTables(prisma);
    const rows = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
        `
            DELETE FROM ${PRIORITY_MESSAGE_PRESETS_TABLE}
            WHERE id = $1
            RETURNING id
        `,
        presetId
    );
    return rows.length > 0;
};

interface EffectivePriorityMessageCandidate {
    templateId: string;
    priority: number;
    scheduleId: string | null;
    updatedAt: Date;
    updatedBy: string | null;
}

export const synchronizePriorityMessageAssignments = async (
    prisma: PrismaClient,
    requestedDeviceIds?: number[]
): Promise<{ changedDeviceIds: number[] }> => {
    await ensurePriorityMessageTables(prisma);
    const devices = await listActiveScheduleDevices(prisma, requestedDeviceIds);
    if (devices.length === 0) {
        return { changedDeviceIds: [] };
    }

    const deviceIds = devices.map((device) => device.id);
    const placeholders = deviceIds.map((_, index) => `$${index + 1}`).join(', ');
    const manualRows = await prisma.$queryRawUnsafe<Array<{
        device_id: number;
        template_id: string;
        updated_at: Date;
        updated_by: string | null;
    }>>(
        `
            SELECT device_id, template_id, updated_at, updated_by
            FROM ${PRIORITY_MESSAGE_MANUAL_ASSIGNMENTS_TABLE}
            WHERE device_id IN (${placeholders})
        `,
        ...deviceIds
    );
    const currentRows = await prisma.$queryRawUnsafe<Array<{
        device_id: number;
        template_id: string;
        active: boolean;
        schedule_id: string | null;
        priority: number | null;
    }>>(
        `
            SELECT device_id, template_id, active, schedule_id, priority
            FROM ${PRIORITY_MESSAGE_ASSIGNMENTS_TABLE}
            WHERE device_id IN (${placeholders})
        `,
        ...deviceIds
    );
    const activeSchedules = (await listPriorityMessageSchedules(prisma)).filter(
        (schedule) => schedule.status === 'active'
    );
    const winners = new Map<number, EffectivePriorityMessageCandidate>();

    for (const schedule of activeSchedules) {
        for (const device of schedule.devices) {
            if (!deviceIds.includes(device.id)) {
                continue;
            }

            const candidate: EffectivePriorityMessageCandidate = {
                templateId: schedule.template.id,
                priority: schedule.priority,
                scheduleId: schedule.id,
                updatedAt: schedule.updatedAt,
                updatedBy: schedule.createdBy
            };
            const current = winners.get(device.id);
            if (
                !current ||
                candidate.priority > current.priority ||
                (
                    candidate.priority === current.priority &&
                    candidate.updatedAt > current.updatedAt
                )
            ) {
                winners.set(device.id, candidate);
            }
        }
    }

    for (const manual of manualRows) {
        winners.set(manual.device_id, {
            templateId: manual.template_id,
            priority: MANUAL_PRIORITY,
            scheduleId: null,
            updatedAt: manual.updated_at,
            updatedBy: manual.updated_by
        });
    }

    const currentByDevice = new Map(currentRows.map((row) => [row.device_id, row]));
    const changedDeviceIds: number[] = [];

    for (const deviceId of deviceIds) {
        const winner = winners.get(deviceId);
        const current = currentByDevice.get(deviceId);
        const changed = winner
            ? !current ||
              !current.active ||
              current.template_id !== winner.templateId ||
              current.schedule_id !== winner.scheduleId ||
              current.priority !== winner.priority
            : Boolean(current?.active);

        if (!changed) {
            continue;
        }

        if (winner) {
            await prisma.$executeRawUnsafe(
                `
                    INSERT INTO ${PRIORITY_MESSAGE_ASSIGNMENTS_TABLE} (
                        device_id,
                        template_id,
                        active,
                        updated_at,
                        updated_by,
                        schedule_id,
                        priority,
                        source_migrated
                    )
                    VALUES ($1, $2, TRUE, NOW(), $3, $4, $5, TRUE)
                    ON CONFLICT (device_id) DO UPDATE SET
                        template_id = EXCLUDED.template_id,
                        active = TRUE,
                        updated_at = NOW(),
                        updated_by = EXCLUDED.updated_by,
                        schedule_id = EXCLUDED.schedule_id,
                        priority = EXCLUDED.priority,
                        source_migrated = TRUE
                `,
                deviceId,
                winner.templateId,
                winner.updatedBy,
                winner.scheduleId,
                winner.priority
            );
        } else {
            await prisma.$executeRawUnsafe(
                `
                    UPDATE ${PRIORITY_MESSAGE_ASSIGNMENTS_TABLE}
                    SET active = FALSE,
                        updated_at = NOW(),
                        updated_by = NULL,
                        schedule_id = NULL,
                        priority = NULL,
                        source_migrated = TRUE
                    WHERE device_id = $1
                `,
                deviceId
            );
        }

        changedDeviceIds.push(deviceId);
    }

    return { changedDeviceIds };
};
