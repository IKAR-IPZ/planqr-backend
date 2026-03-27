import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const ROLE_SPLIT_PATTERN = /[,\s|;:+]+/;
let hasLoggedRoleLookupError = false;

export interface AccessSignals {
    title?: string;
    employeeTypes?: string[];
    affiliations?: string[];
    memberOf?: string[];
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
    isLecturer: boolean | null;
    lecturerStatusResolved: boolean;
    canAccessLecturerPlan: boolean;
    lecturerAccessSource: 'env' | 'ldap' | 'unknown';
}

export interface AuthenticatedUser extends IdentityClaims, AccessProfile {
    login: string;
    displayName: string;
}

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

const buildDisplayName = (givenName?: string, surname?: string) =>
    [surname?.trim(), givenName?.trim()].filter(Boolean).join(' ').trim();

const buildResolvedDisplayName = (identity: IdentityClaims) => {
    const displayNameOverride = identity.displayNameOverride?.trim();
    if (displayNameOverride) {
        return displayNameOverride;
    }

    return buildDisplayName(identity.givenName, identity.surname);
};

const collectNormalizedSignals = (signals?: AccessSignals) => [
    ...(signals?.employeeTypes ?? []),
    ...(signals?.affiliations ?? []),
    ...(signals?.memberOf ?? []),
    ...(signals?.title ? [signals.title] : []),
].map(normalizeValue).filter(Boolean);

const hasKeyword = (values: string[], keywords: string[]) =>
    values.some((value) => keywords.some((keyword) => value.includes(keyword)));

const inferLecturerFromSignals = (signals?: AccessSignals) => {
    const normalizedSignals = collectNormalizedSignals(signals);

    if (normalizedSignals.length === 0) {
        return {
            isLecturer: null,
            lecturerStatusResolved: false,
            lecturerAccessSource: 'unknown' as const,
        };
    }

    const positiveKeywords = [
        'lecturer',
        'teacher',
        'instructor',
        'faculty',
        'academic',
        'dydakty',
        'wykladow',
        'adiunkt',
        'asystent',
        'profesor',
        'professor',
    ];

    const negativeKeywords = ['student', 'studentka', 'studentow', 'studentka'];

    if (hasKeyword(normalizedSignals, positiveKeywords)) {
        return {
            isLecturer: true,
            lecturerStatusResolved: true,
            lecturerAccessSource: 'ldap' as const,
        };
    }

    if (hasKeyword(normalizedSignals, negativeKeywords)) {
        return {
            isLecturer: false,
            lecturerStatusResolved: true,
            lecturerAccessSource: 'ldap' as const,
        };
    }

    return {
        isLecturer: null,
        lecturerStatusResolved: false,
        lecturerAccessSource: 'unknown' as const,
    };
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

    const inferredAccess = inferLecturerFromSignals(signals);

    if (inferredAccess.isLecturer === true) {
        return {
            roles: Array.from(roles).sort(),
            isAdmin,
            isLecturer: true,
            lecturerStatusResolved: true,
            canAccessLecturerPlan: true,
            lecturerAccessSource: inferredAccess.lecturerAccessSource,
        };
    }

    if (inferredAccess.isLecturer === false) {
        return {
            roles: Array.from(roles).sort(),
            isAdmin,
            isLecturer: false,
            lecturerStatusResolved: true,
            canAccessLecturerPlan: false,
            lecturerAccessSource: inferredAccess.lecturerAccessSource,
        };
    }

    return {
        roles: Array.from(roles).sort(),
        isAdmin,
        isLecturer: null,
        lecturerStatusResolved: false,
        canAccessLecturerPlan: false,
        lecturerAccessSource: 'unknown',
    };
};

const buildDevBypassAccessProfile = (): AccessProfile => ({
    roles: [],
    isAdmin: false,
    isLecturer: true,
    lecturerStatusResolved: true,
    canAccessLecturerPlan: true,
    lecturerAccessSource: 'env',
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
        isLecturer: user.isLecturer,
        lecturerStatusResolved: user.lecturerStatusResolved,
        canAccessLecturerPlan: user.canAccessLecturerPlan,
        lecturerAccessSource: user.lecturerAccessSource,
    }
});
