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

const getKnownUsernamesForLdapSync = async () => {
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

    return rows.map((row) => row.username);
};

const syncAllLdapUsers = async () => {
    const syncStartedAt = new Date();
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
};

export const syncLdapUsers = async () => {
    if (!env.LDAP_SYNC_ENABLED || !ldapDirectoryService.isConfigured()) {
        return {
            status: 'disabled',
            mode: env.LDAP_SYNC_MODE,
            known: 0,
            synced: 0,
            missing: 0,
        };
    }

    if (env.LDAP_SYNC_MODE === 'all') {
        return syncAllLdapUsers();
    }

    const usernames = await getKnownUsernamesForLdapSync();
    if (!usernames.length) {
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
