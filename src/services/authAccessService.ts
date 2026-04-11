import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
let hasLoggedAdminLookupError = false;

export interface AccessSignals {
    title?: string;
}

export interface IdentityClaims extends AccessSignals {
    sub: string;
    givenName?: string;
    surname?: string;
    devAuthBypass?: boolean;
    displayNameOverride?: string;
}

export interface AccessProfile {
    roles: string[];
    isAdmin: boolean;
    canAccessLecturerPlan: boolean;
}

export interface AuthenticatedUser extends IdentityClaims, AccessProfile {
    login: string;
    displayName: string;
}

const trimText = (value?: string) => value?.trim() ?? '';

export const buildDisplayName = (givenName?: string, surname?: string) =>
    [trimText(surname), trimText(givenName)].filter(Boolean).join(' ').trim();

export const hasRequiredLdapIdentityData = (identity: Pick<IdentityClaims, 'givenName' | 'surname' | 'title'>) =>
    Boolean(trimText(identity.givenName) && trimText(identity.surname) && trimText(identity.title));

const buildResolvedDisplayName = (identity: IdentityClaims) => {
    const displayNameOverride = trimText(identity.displayNameOverride);
    if (displayNameOverride) {
        return displayNameOverride;
    }

    return buildDisplayName(identity.givenName, identity.surname);
};

const hasStoredAdminAccess = async (username: string) => {
    try {
        const [admin] = await prisma.$queryRaw<Array<{ id: string }>>`
            SELECT "id"
            FROM "admins"
            WHERE "username" = ${username}
            LIMIT 1
        `;

        return Boolean(admin);
    } catch (error) {
        if (!hasLoggedAdminLookupError) {
            hasLoggedAdminLookupError = true;
            console.error('[Auth] Failed to read Admin access from database.', error);
        }

        return false;
    }
};

export const resolveAccessProfile = async (
    username: string,
    signals?: AccessSignals
): Promise<AccessProfile> => {
    const isAdmin = await hasStoredAdminAccess(username);
    const isStudent = signals?.title === 'student';

    return {
        roles: isAdmin ? ['admin'] : [],
        isAdmin,
        canAccessLecturerPlan: !isStudent,
    };
};

const buildDevBypassAccessProfile = (): AccessProfile => ({
    roles: ['admin'],
    isAdmin: true,
    canAccessLecturerPlan: true,
});

export const buildAuthenticatedUser = async (
    identity: IdentityClaims
): Promise<AuthenticatedUser> => {
    const access = identity.devAuthBypass
        ? buildDevBypassAccessProfile()
        : await resolveAccessProfile(identity.sub, identity);

    return {
        ...identity,
        login: identity.sub,
        displayName: buildResolvedDisplayName(identity),
        ...access,
    };
};

export const toSessionResponse = (user: AuthenticatedUser, message: string) => ({
    message,
    login: user.login,
    displayName: user.displayName,
    givenName: user.givenName ?? '',
    surname: user.surname ?? '',
    title: user.title ?? '',
    access: {
        roles: user.roles,
        isAdmin: user.isAdmin,
        canAccessLecturerPlan: user.canAccessLecturerPlan,
    }
});
