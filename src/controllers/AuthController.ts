import { Request, Response } from 'express';
import { LdapService } from '../services/LdapService';
import { env } from '../config/env';
import {
    buildAuthenticatedUser,
    hasRequiredLdapIdentityData,
    toSessionResponse,
    type IdentityClaims
} from '../services/authAccessService';
import { createAccessToken, decodeIdentityClaimsFromToken } from '../services/authTokenService';

const ldapService = new LdapService();

export class AuthController {
    private static buildLoginErrorResponse(reason: 'invalid_credentials' | 'timeout' | 'service_unavailable' | 'unexpected') {
        switch (reason) {
            case 'invalid_credentials':
                return {
                    status: 401,
                    body: {
                        code: 'INVALID_CREDENTIALS',
                        message: 'Nieprawidłowy login lub hasło.'
                    }
                };
            case 'timeout':
                return {
                    status: 504,
                    body: {
                        code: 'LDAP_TIMEOUT',
                        message: 'Serwer LDAP nie odpowiedział na czas. Spróbuj ponownie za chwilę.'
                    }
                };
            case 'service_unavailable':
                return {
                    status: 503,
                    body: {
                        code: 'LDAP_UNAVAILABLE',
                        message: 'Serwer LDAP jest obecnie niedostępny. Spróbuj ponownie za chwilę.'
                    }
                };
            default:
                return {
                    status: 500,
                    body: {
                        code: 'AUTH_ERROR',
                        message: 'Wystąpił błąd podczas logowania. Spróbuj ponownie.'
                    }
                };
        }
    }

    static async login(req: Request, res: Response) {
        console.log(`Login request received. NODE_ENV=${env.NODE_ENV}, DEV_AUTH_BYPASS=${env.DEV_AUTH_BYPASS}, Origin=${req.headers.origin}`);
        try {
            const username = typeof req.body?.username === 'string' ? req.body.username.trim() : '';
            const password = typeof req.body?.password === 'string' ? req.body.password : '';

            if (!username) {
                return res.status(400).json({ message: 'Invalid request' });
            }

            if (env.DEV_AUTH_BYPASS) {
                const identity: IdentityClaims = {
                    sub: username,
                    givenName: '',
                    surname: '',
                    title: '',
                    devAuthBypass: true,
                    displayNameOverride: username,
                };

                console.log(`[Auth] DEV_AUTH_BYPASS active, skipping LDAP for user "${username}".`);

                const user = await buildAuthenticatedUser(identity);
                const token = createAccessToken(identity);

                res.cookie('jwt', token, {
                    httpOnly: true,
                    secure: env.NODE_ENV === 'production',
                    sameSite: env.NODE_ENV === 'production' ? 'strict' : 'lax'
                });

                return res.status(200).json(toSessionResponse(user, 'Login successful'));
            }

            const authResult = await ldapService.authenticate(username, password);

            if (authResult.outcome === 'authenticated') {
                const identity: IdentityClaims = {
                    sub: username,
                    givenName: authResult.givenName ?? '',
                    surname: authResult.surname ?? '',
                    title: authResult.title ?? '',
                };

                console.log('[Auth] LDAP attributes:', JSON.stringify({
                    username,
                    givenName: identity.givenName,
                    surname: identity.surname,
                    title: identity.title,
                }, null, 2));

                if (!hasRequiredLdapIdentityData(identity)) {
                    console.error('[Auth] LDAP returned incomplete identity data.', JSON.stringify({
                        username,
                        givenName: identity.givenName,
                        surname: identity.surname,
                        title: identity.title,
                    }, null, 2));

                    return res.status(500).json({
                        code: 'AUTH_ERROR',
                        message: 'Wystąpił błąd podczas logowania. Spróbuj ponownie.'
                    });
                }

                const user = await buildAuthenticatedUser(identity);

                if (!user.isAdmin && !user.canAccessLecturerPlan) {
                    return res.status(403).json({
                        message: 'Authenticated successfully, but this account has no PlanQR access.',
                        access: toSessionResponse(user, 'Access denied').access
                    });
                }

                const token = createAccessToken(identity);
                res.cookie('jwt', token, {
                    httpOnly: true,
                    secure: env.NODE_ENV === 'production',
                    sameSite: env.NODE_ENV === 'production' ? 'strict' : 'lax'
                });

                return res.status(200).json(toSessionResponse(user, 'Login successful'));
            }

            const loginError = AuthController.buildLoginErrorResponse(authResult.reason);
            return res.status(loginError.status).json(loginError.body);
        } catch (error) {
            console.error('Login error:', error);
            return res.status(500).json({
                code: 'AUTH_ERROR',
                message: 'Wystąpił błąd podczas logowania. Spróbuj ponownie.'
            });
        }
    }

    static async logout(req: Request, res: Response) {
        res.clearCookie('jwt');
        return res.status(200).json({ message: 'Logout successful' });
    }

    static async checkLogin(req: Request, res: Response) {
        const token = req.cookies.jwt;
        if (!token) return res.status(401).json({ message: 'Not logged in' });

        try {
            const identity = decodeIdentityClaimsFromToken(token);
            if (!identity) {
                return res.status(401).json({ message: 'Token has expired or is invalid' });
            }

            const user = await buildAuthenticatedUser(identity);
            return res.status(200).json(toSessionResponse(user, 'Logged in'));
        } catch (e) {
            return res.status(401).json({ message: 'Token has expired or is invalid' });
        }
    }

    static async validateToken(req: Request, res: Response) {
        const token = req.cookies.jwt;
        if (!token) return res.status(401).json({ message: 'Token is missing' });

        try {
            const identity = decodeIdentityClaimsFromToken(token);
            if (!identity) {
                return res.status(401).json({ message: 'Token has expired' });
            }

            const user = await buildAuthenticatedUser(identity);
            return res.status(200).json(toSessionResponse(user, 'Token is valid'));
        } catch (e) {
            return res.status(401).json({ message: 'Token has expired' });
        }
    }
}
