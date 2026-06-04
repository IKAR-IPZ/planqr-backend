import { PrismaClient } from '@prisma/client';

const PRIORITY_MESSAGE_TEMPLATES_TABLE = 'tablet_priority_message_templates';
const PRIORITY_MESSAGE_ASSIGNMENTS_TABLE = 'tablet_priority_message_assignments';
const DEVICE_LIST_TABLE = '"DeviceList"';

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
}

export const DEFAULT_TABLET_PRIORITY_MESSAGE: TabletPriorityMessage = {
    enabled: false,
    template: null,
    updatedAt: null,
    updatedBy: null
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
    updatedBy: row.updated_by
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
            INSERT INTO ${PRIORITY_MESSAGE_ASSIGNMENTS_TABLE} (
                device_id,
                template_id,
                active,
                updated_at,
                updated_by
            )
            SELECT id, ${templateParam}, TRUE, NOW(), ${updatedByParam}
            FROM ${DEVICE_LIST_TABLE}
            WHERE id IN (${placeholders})
              AND status = 'ACTIVE'
            ON CONFLICT (device_id) DO UPDATE SET
                template_id = EXCLUDED.template_id,
                active = TRUE,
                updated_at = NOW(),
                updated_by = EXCLUDED.updated_by
            RETURNING device_id
        `,
        ...input.deviceIds,
        input.templateId,
        input.updatedBy
    );

    return rows.map((row) => row.device_id);
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
    const updatedByParam = `$${input.deviceIds.length + 1}`;

    const rows = await prisma.$queryRawUnsafe<Array<{ device_id: number }>>(
        `
            UPDATE ${PRIORITY_MESSAGE_ASSIGNMENTS_TABLE}
            SET active = FALSE,
                updated_at = NOW(),
                updated_by = ${updatedByParam}
            WHERE device_id IN (${placeholders})
            RETURNING device_id
        `,
        ...input.deviceIds,
        input.updatedBy
    );

    return rows.map((row) => row.device_id);
};
