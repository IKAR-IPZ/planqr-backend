import { PrismaClient } from '@prisma/client';

const DEVICE_LIST_TABLE = '"DeviceList"';
const TABLET_IP_BANS_TABLE = '"tablet_ip_bans"';

export const normalizeTabletIpAddress = (value: unknown) =>
    typeof value === 'string' ? value.trim() : '';

export const ensureTabletIpBanStorage = async (prisma: PrismaClient) => {
    await prisma.$executeRawUnsafe(`
        ALTER TABLE ${DEVICE_LIST_TABLE}
        ADD COLUMN IF NOT EXISTS "lastIpAddress" VARCHAR(128)
    `);

    await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS ${TABLET_IP_BANS_TABLE} (
            "id" SERIAL PRIMARY KEY,
            "ip_address" VARCHAR(128) NOT NULL UNIQUE,
            "device_id" VARCHAR(64),
            "reason" TEXT,
            "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            "created_by" TEXT
        )
    `);
};

export const isTabletIpBanned = async (prisma: PrismaClient, ipAddress: string) => {
    const normalizedIpAddress = normalizeTabletIpAddress(ipAddress);

    if (!normalizedIpAddress || normalizedIpAddress === 'unknown') {
        return false;
    }

    await ensureTabletIpBanStorage(prisma);
    const rows = await prisma.$queryRaw<
        Array<{ id: number }>
    >`SELECT "id" FROM "tablet_ip_bans" WHERE "ip_address" = ${normalizedIpAddress} LIMIT 1`;

    return rows.length > 0;
};

export const banTabletIpAddress = async (
    prisma: PrismaClient,
    input: {
        ipAddress: string;
        deviceId?: string | null;
        reason?: string | null;
        createdBy?: string | null;
    }
) => {
    const normalizedIpAddress = normalizeTabletIpAddress(input.ipAddress);

    if (!normalizedIpAddress || normalizedIpAddress === 'unknown') {
        throw new Error('Brak poprawnego adresu IP do zbanowania.');
    }

    await ensureTabletIpBanStorage(prisma);
    const rows = await prisma.$queryRaw<
        Array<{
            id: number;
            ip_address: string;
            device_id: string | null;
            reason: string | null;
            created_at: Date;
            created_by: string | null;
        }>
    >`
        INSERT INTO "tablet_ip_bans" ("ip_address", "device_id", "reason", "created_by")
        VALUES (
            ${normalizedIpAddress},
            ${input.deviceId ?? null},
            ${input.reason ?? 'admin-pending-tablet-ban'},
            ${input.createdBy ?? null}
        )
        ON CONFLICT ("ip_address") DO UPDATE SET
            "device_id" = COALESCE(EXCLUDED."device_id", "tablet_ip_bans"."device_id"),
            "reason" = COALESCE(EXCLUDED."reason", "tablet_ip_bans"."reason"),
            "created_by" = COALESCE(EXCLUDED."created_by", "tablet_ip_bans"."created_by")
        RETURNING "id", "ip_address", "device_id", "reason", "created_at", "created_by"
    `;

    return rows[0];
};
