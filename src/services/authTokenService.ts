import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import { type IdentityClaims } from './authAccessService';

const ISSUER = 'PlanQR_Issuer';
const AUDIENCE = 'PlanQR_Audience';
const ACCESS_TOKEN_VERSION = 2;

type AccessTokenPayload = jwt.JwtPayload & {
    sub: string;
    givenName?: unknown;
    surname?: unknown;
    title?: unknown;
    employeeTypes?: unknown;
    affiliations?: unknown;
    memberOf?: unknown;
    planqrAccessVersion?: unknown;
    devAuthBypass?: unknown;
    displayNameOverride?: unknown;
};

const toStringArray = (value: unknown) =>
    Array.isArray(value) ? value.map((item) => String(item)) : [];

export const createAccessToken = (identity: IdentityClaims) =>
    jwt.sign(
        {
            sub: identity.sub,
            givenName: identity.givenName ?? '',
            surname: identity.surname ?? '',
            title: identity.title ?? '',
            employeeTypes: identity.employeeTypes ?? [],
            affiliations: identity.affiliations ?? [],
            memberOf: identity.memberOf ?? [],
            devAuthBypass: identity.devAuthBypass === true,
            displayNameOverride: identity.displayNameOverride,
            planqrAccessVersion: ACCESS_TOKEN_VERSION,
            jti: Date.now().toString(),
        },
        env.JWT_SECRET,
        {
            expiresIn: '24h',
            issuer: ISSUER,
            audience: AUDIENCE,
        }
    );

export const decodeIdentityClaimsFromToken = (token: string): IdentityClaims | null => {
    try {
        const decoded = jwt.verify(token, env.JWT_SECRET);
        if (!decoded || typeof decoded === 'string' || typeof decoded.sub !== 'string') {
            return null;
        }

        const payload = decoded as AccessTokenPayload;

        if (payload.planqrAccessVersion !== ACCESS_TOKEN_VERSION) {
            return null;
        }

        const devAuthBypass = payload.devAuthBypass === true;
        if (devAuthBypass && !env.DEV_AUTH_BYPASS) {
            return null;
        }

        return {
            sub: payload.sub,
            givenName: typeof payload.givenName === 'string' ? payload.givenName : '',
            surname: typeof payload.surname === 'string' ? payload.surname : '',
            title: typeof payload.title === 'string' ? payload.title : '',
            employeeTypes: toStringArray(payload.employeeTypes),
            affiliations: toStringArray(payload.affiliations),
            memberOf: toStringArray(payload.memberOf),
            devAuthBypass,
            displayNameOverride:
                typeof payload.displayNameOverride === 'string' ? payload.displayNameOverride : undefined,
        };
    } catch (error) {
        return null;
    }
};
