import ldap from 'ldapjs';
import { Prisma, PrismaClient } from '@prisma/client';
import { env } from '../config/env';
import { LdapDirectoryService, type LdapDirectoryUser } from './ldapDirectoryService';

const prisma = new PrismaClient();
const ldapDirectoryService = new LdapDirectoryService();
let hasLoggedCacheReadError = false;
let hasLoggedCacheWriteError = false;

export interface CachedLdapUser {
    username: string;
    displayName: string;
    givenName: string | null;
    surname: string | null;
    title: string | null;
    email: string | null;
    isActive: number;
    ldapSyncedAt: Date | null;
}

const normalizeText = (value?: string | null) => String(value ?? '').trim();
const normalizeUsername = (value?: string | null) => normalizeText(value).toLowerCase();
const toNullableText = (value?: string | null) => normalizeText(value) || null;
const buildDisplayName = (givenName?: string | null, surname?: string | null, fallback?: string | null) =>
    [normalizeText(surname), normalizeText(givenName)].filter(Boolean).join(' ').trim() ||
    normalizeText(fallback);
const LDAP_ADMIN_LIMIT_EXCEEDED_CODE = '11';

export const findCachedLdapUsersByUsername = async (usernames: string[]) => {
    const normalizedUsernames = Array.from(
        new Set(usernames.map(normalizeUsername).filter(Boolean))
    );

    if (!normalizedUsernames.length) {
        return new Map<string, CachedLdapUser>();
    }

    try {
        const rows = await prisma.$queryRaw<CachedLdapUser[]>`
            SELECT
                username,
                display_name AS "displayName",
                given_name AS "givenName",
                surname,
                title,
                email,
                is_active AS "isActive",
                ldap_synced_at AS "ldapSyncedAt"
            FROM ldap_users
            WHERE username IN (${Prisma.join(normalizedUsernames)})
              AND is_active = 1
        `;

        return new Map(rows.map((row) => [normalizeUsername(row.username), row]));
    } catch (error) {
        if (!hasLoggedCacheReadError) {
            hasLoggedCacheReadError = true;
            console.error('[LDAP Cache] Failed to read ldap_users. Attendance will fall back to usernames.', error);
        }

        return new Map<string, CachedLdapUser>();
    }
};

export const upsertCachedLdapUser = async (user: LdapDirectoryUser) => {
    const username = normalizeUsername(user.username);
    const displayName = normalizeText(user.displayName) ||
        buildDisplayName(user.givenName, user.surname, username);

    if (!username || !displayName) {
        return;
    }

    try {
        await prisma.$executeRaw`
            INSERT INTO ldap_users (
                username,
                display_name,
                given_name,
                surname,
                title,
                email,
                is_active,
                ldap_synced_at,
                created_at,
                updated_at
            )
            VALUES (
                ${username},
                ${displayName},
                ${toNullableText(user.givenName)},
                ${toNullableText(user.surname)},
                ${toNullableText(user.title)},
                ${toNullableText(user.email)},
                1,
                CURRENT_TIMESTAMP,
                CURRENT_TIMESTAMP,
                CURRENT_TIMESTAMP
            )
            ON CONFLICT (username) DO UPDATE
                SET display_name = EXCLUDED.display_name,
                    given_name = EXCLUDED.given_name,
                    surname = EXCLUDED.surname,
                    title = EXCLUDED.title,
                    email = EXCLUDED.email,
                    is_active = 1,
                    ldap_synced_at = EXCLUDED.ldap_synced_at,
                    updated_at = CURRENT_TIMESTAMP
        `;
    } catch (error) {
        if (!hasLoggedCacheWriteError) {
            hasLoggedCacheWriteError = true;
            console.error('[LDAP Cache] Failed to write ldap_users.', error);
        }
    }
};

const markUsersNotSyncedSinceInactive = async (syncedAfter: Date) => {
    try {
        await prisma.$executeRaw`
            UPDATE ldap_users
            SET is_active = 0,
                updated_at = CURRENT_TIMESTAMP
            WHERE ldap_synced_at IS NULL
               OR ldap_synced_at < ${syncedAfter}
        `;
    } catch (error) {
        if (!hasLoggedCacheWriteError) {
            hasLoggedCacheWriteError = true;
            console.error('[LDAP Cache] Failed to deactivate stale ldap_users rows.', error);
        }
    }
};

export const upsertAuthenticatedLdapUser = async (identity: {
    username: string;
    givenName?: string | null;
    surname?: string | null;
    title?: string | null;
}) => {
    const username = normalizeUsername(identity.username);
    const displayName = buildDisplayName(identity.givenName, identity.surname, username);

    if (!username || !displayName) {
        return;
    }

    await upsertCachedLdapUser({
        username,
        displayName,
        givenName: normalizeText(identity.givenName),
        surname: normalizeText(identity.surname),
        title: normalizeText(identity.title),
        email: '',
    });
};

const markCachedLdapUserMissing = async (usernameValue: string) => {
    const username = normalizeUsername(usernameValue);
    if (!username) {
        return;
    }

    try {
        await prisma.$executeRaw`
            INSERT INTO ldap_users (
                username,
                display_name,
                is_active,
                ldap_synced_at,
                created_at,
                updated_at
            )
            VALUES (
                ${username},
                ${username},
                0,
                CURRENT_TIMESTAMP,
                CURRENT_TIMESTAMP,
                CURRENT_TIMESTAMP
            )
            ON CONFLICT (username) DO UPDATE
                SET is_active = 0,
                    ldap_synced_at = CURRENT_TIMESTAMP,
                    updated_at = CURRENT_TIMESTAMP
        `;
    } catch (error) {
        if (!hasLoggedCacheWriteError) {
            hasLoggedCacheWriteError = true;
            console.error('[LDAP Cache] Failed to mark missing ldap_users row.', error);
        }
    }
};

const getKnownUserSourceCounts = async () => {
    const [counts] = await prisma.$queryRaw<Array<{
        tbluser: number;
        tbldydaktyk: number;
        ldapUsers: number;
        admins: number;
    }>>`
        SELECT
            CAST((SELECT COUNT(*) FROM tbluser WHERE username IS NOT NULL AND BTRIM(username) <> '') AS INTEGER) AS "tbluser",
            CAST((SELECT COUNT(*) FROM tbldydaktyk WHERE username IS NOT NULL AND BTRIM(username) <> '') AS INTEGER) AS "tbldydaktyk",
            CAST((SELECT COUNT(*) FROM ldap_users WHERE username IS NOT NULL AND BTRIM(username) <> '') AS INTEGER) AS "ldapUsers",
            CAST((SELECT COUNT(*) FROM "admins" WHERE "username" IS NOT NULL AND BTRIM("username") <> '') AS INTEGER) AS "admins"
    `;

    return counts ?? {
        tbluser: 0,
        tbldydaktyk: 0,
        ldapUsers: 0,
        admins: 0,
    };
};

const getKnownUsernamesForLdapSync = async () => {
    const sourceCounts = await getKnownUserSourceCounts();
    const rows = await prisma.$queryRaw<Array<{ username: string }>>`
        SELECT username
        FROM (
            SELECT username FROM tbluser
            UNION
            SELECT username FROM tbldydaktyk
            UNION
            SELECT username FROM ldap_users
            UNION
            SELECT "username" AS username FROM "admins"
        ) AS known_users
        WHERE username IS NOT NULL
          AND BTRIM(username) <> ''
        ORDER BY username ASC
        LIMIT ${env.LDAP_SYNC_KNOWN_USER_LIMIT}
    `;

    const sampleUsernames = rows.slice(0, 10).map((row) => row.username).join(', ');
    console.log(
        `[LDAP Cache] Known-user candidates. total=${rows.length}, limit=${env.LDAP_SYNC_KNOWN_USER_LIMIT}, sources={tbluser:${sourceCounts.tbluser}, tbldydaktyk:${sourceCounts.tbldydaktyk}, ldap_users:${sourceCounts.ldapUsers}, admins:${sourceCounts.admins}}${sampleUsernames ? `, sample=[${sampleUsernames}]` : ''}.`
    );

    return rows.map((row) => row.username);
};

const isAdminLimitExceededError = (error: unknown) => {
    if (error instanceof ldap.AdminLimitExceededError) {
        return true;
    }

    const name = getErrorProperty(error, 'name');
    const code = getErrorProperty(error, 'code');
    const message = getErrorMessage(error).toLowerCase();

    return (
        name === 'AdminLimitExceededError' ||
        code === LDAP_ADMIN_LIMIT_EXCEEDED_CODE ||
        message.includes('admin limit exceeded')
    );
};

const getErrorMessage = (error: unknown): string => {
    if (error instanceof Error && error.message) {
        return error.message;
    }

    if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') {
        return error.message;
    }

    return 'Unknown LDAP error';
};

const getErrorProperty = (error: unknown, property: 'name' | 'code'): string | null => {
    if (!error || typeof error !== 'object' || !(property in error)) {
        return null;
    }

    const errorRecord = error as Record<string, unknown>;
    const value = errorRecord[property];
    return typeof value === 'string' || typeof value === 'number' ? String(value) : null;
};

const syncAllLdapUsers = async () => {
    const syncStartedAt = new Date();
    console.log('[LDAP Cache] Starting full LDAP cache sync.');
    try {
        const directoryUsers = await ldapDirectoryService.findAllUsers();
        let synced = 0;

        for (const user of directoryUsers) {
            await upsertCachedLdapUser(user);
            synced += 1;
        }

        if (env.LDAP_SYNC_FULL_USER_LIMIT === 0) {
            await markUsersNotSyncedSinceInactive(syncStartedAt);
        }

        return {
            status: 'success',
            mode: 'all',
            known: directoryUsers.length,
            synced,
            missing: 0,
        };
    } catch (error) {
        if (!isAdminLimitExceededError(error)) {
            console.error('[LDAP Cache] Full LDAP cache sync failed before fallback.', error);
            throw error;
        }

        console.warn(
            `[LDAP Cache] Full LDAP sync hit admin limit; falling back to known users. reason="${getErrorMessage(error)}".`
        );
        return syncKnownLdapUsers();
    }
};

const syncKnownLdapUsers = async () => {
    console.log('[LDAP Cache] Starting known-user LDAP cache sync.');
    const usernames = await getKnownUsernamesForLdapSync();
    if (!usernames.length) {
        console.log(
            '[LDAP Cache] Known-user LDAP cache sync has no usernames to query. Add usernames to tbluser, tbldydaktyk, ldap_users, or admins, or narrow the full LDAP filter.'
        );
        return {
            status: 'success',
            mode: 'known',
            known: 0,
            synced: 0,
            missing: 0,
        };
    }

    const directoryUsers = await ldapDirectoryService.findUsers(usernames);
    let synced = 0;
    let missing = 0;

    for (const username of usernames) {
        const normalizedUsername = normalizeUsername(username);
        const directoryUser = directoryUsers.get(normalizedUsername);

        if (directoryUser) {
            await upsertCachedLdapUser(directoryUser);
            synced += 1;
            continue;
        }

        await markCachedLdapUserMissing(normalizedUsername);
        missing += 1;
    }

    return {
        status: 'success',
        mode: 'known',
        known: usernames.length,
        synced,
        missing,
    };
};

export const syncLdapUsers = async () => {
    if (!env.LDAP_SYNC_ENABLED || !ldapDirectoryService.isConfigured()) {
        console.log(
            `[LDAP Cache] Sync disabled or not configured. LDAP_SYNC_ENABLED=${env.LDAP_SYNC_ENABLED}, directoryConfigured=${ldapDirectoryService.isConfigured()}.`
        );
        return {
            status: 'disabled',
            mode: env.LDAP_SYNC_MODE,
            known: 0,
            synced: 0,
            missing: 0,
        };
    }

    console.log(
        `[LDAP Cache] Sync enabled. mode=${env.LDAP_SYNC_MODE}, fullFilter="${env.LDAP_SYNC_FULL_FILTER}", fullPageSize=${env.LDAP_SYNC_FULL_PAGE_SIZE}, fullUserLimit=${env.LDAP_SYNC_FULL_USER_LIMIT}, knownLimit=${env.LDAP_SYNC_KNOWN_USER_LIMIT}, batchSize=${env.LDAP_SYNC_BATCH_SIZE}.`
    );

    if (env.LDAP_SYNC_MODE === 'all') {
        return syncAllLdapUsers();
    }

    return syncKnownLdapUsers();
};
