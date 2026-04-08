import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const ROLE_SPLIT_PATTERN = /[,\s|;:+]+/;
let hasLoggedRoleLookupError = false;

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

const normalizeValue = (value: string) =>
    value
        .trim()
        .toLowerCase()
        .normalize('NFD')
        .replace(/\p{Diacritic}/gu, '');

const mapRoleToken = (value: string) => {
    switch (value) {
        case 'administrator':
        case 'admin':
            return 'admin';
        default:
            return value;
    }
};

const parseRoleTokens = (value?: string | null) =>
    new Set(
        (value ?? '')
            .replace(/[_-]/g, ' ')
            .split(ROLE_SPLIT_PATTERN)
            .map(normalizeValue)
            .map(mapRoleToken)
            .filter((token) => token === 'admin')
    );

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

const getStoredRoles = async (username: string) => {
    try {
        const user = await prisma.user.findUnique({
            where: { username },
            select: { role: true }
        });

        return parseRoleTokens(user?.role);
    } catch (error) {
        if (!hasLoggedRoleLookupError) {
            hasLoggedRoleLookupError = true;
            console.error('[Auth] Failed to read User roles from database.', error);
        }

        return new Set<string>();
    }
};

export const resolveAccessProfile = async (
    username: string,
    signals?: AccessSignals
): Promise<AccessProfile> => {
    const storedRoles = await getStoredRoles(username);
    const roles = new Set<string>(storedRoles);
    const isAdmin = roles.has('admin');
    const isStudent = signals?.title === 'student';

    return {
        roles: Array.from(roles).sort(),
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
