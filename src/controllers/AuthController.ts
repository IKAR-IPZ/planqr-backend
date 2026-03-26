import { Request, Response } from 'express';
import { LdapService } from '../services/LdapService';
import { env } from '../config/env';
import jwt from 'jsonwebtoken';
import { buildAuthenticatedUser, toSessionResponse } from '../services/authAccessService';

const ldapService = new LdapService();
const ISSUER = "PlanQR_Issuer"; // From C# config likely
const AUDIENCE = "PlanQR_Audience";
const ACCESS_TOKEN_VERSION = 2;

export class AuthController {

    static async login(req: Request, res: Response) {
        console.log(`Login request received. NODE_ENV=${env.NODE_ENV}, Origin=${req.headers.origin}, Cookies=${JSON.stringify(req.cookies)}`);
        try {
            const { username, password } = req.body;

            if (!username) {
                return res.status(400).json({ message: 'Invalid request' });
            }

            // In C#: var (isAuthenticated, givenName, surname, title) = _ldapService.Authenticate...
            // We need to update LdapService to return these details, or mock them for now.
            // Assuming LdapService returns boolean for now, we'll fetch details if true.

            const {
                isAuthenticated,
                givenName = '',
                surname = '',
                title = '',
                employeeTypes = [],
                affiliations = [],
                memberOf = [],
            } = await ldapService.authenticate(username, password as string);

            if (isAuthenticated) {
                console.log('[Auth] LDAP attributes:', JSON.stringify({
                    username,
                    givenName,
                    surname,
                    title,
                    employeeTypes,
                    affiliations,
                    memberOf
                }, null, 2));

                const user = await buildAuthenticatedUser({
                    sub: username,
                    givenName,
                    surname,
                    title,
                    employeeTypes,
                    affiliations,
                    memberOf,
                });

                if (!user.isAdmin && !user.canAccessLecturerPlan) {
                    return res.status(403).json({
                        message: 'Authenticated successfully, but this account has no PlanQR access.',
                        access: toSessionResponse(user, 'Access denied').access
                    });
                }

                // Generate JWT
                const token = jwt.sign(
                    {
                        sub: username,
                        givenName,
                        surname,
                        title,
                        employeeTypes,
                        affiliations,
                        memberOf,
                        planqrAccessVersion: ACCESS_TOKEN_VERSION,
                        jti: Date.now().toString()
                    },
                    env.JWT_SECRET,
                    {
                        expiresIn: '24h',
                        issuer: ISSUER,
                        audience: AUDIENCE
                    }
                );

                res.cookie('jwt', token, {
                    httpOnly: true,
                    secure: env.NODE_ENV === 'production',
                    sameSite: env.NODE_ENV === 'production' ? 'strict' : 'lax'
                });

                return res.status(200).json(toSessionResponse(user, 'Login successful'));
            } else {
                return res.status(401).json({ message: 'Invalid username or password' });
            }
        } catch (error) {
            console.error('Login error:', error);
            // C# returns Unauthorized on almost everything here? No, C# returns 500 equivalent usually for crashes, but 401 for bad creds
            return res.status(500).json({ message: 'Internal server error' });
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
            const decoded = jwt.verify(token, env.JWT_SECRET) as any;
            if (decoded.planqrAccessVersion !== ACCESS_TOKEN_VERSION) {
                return res.status(401).json({ message: 'Token has expired or is invalid' });
            }
            const user = await buildAuthenticatedUser({
                sub: decoded.sub,
                givenName: decoded.givenName,
                surname: decoded.surname,
                title: decoded.title,
                employeeTypes: Array.isArray(decoded.employeeTypes) ? decoded.employeeTypes : [],
                affiliations: Array.isArray(decoded.affiliations) ? decoded.affiliations : [],
                memberOf: Array.isArray(decoded.memberOf) ? decoded.memberOf : [],
            });
            return res.status(200).json(toSessionResponse(user, 'Logged in'));
        } catch (e) {
            return res.status(401).json({ message: 'Token has expired or is invalid' });
        }
    }

    static async validateToken(req: Request, res: Response) {
        const token = req.cookies.jwt;
        if (!token) return res.status(401).json({ message: 'Token is missing' });

        try {
            const decoded = jwt.verify(token, env.JWT_SECRET) as any;
            if (decoded.planqrAccessVersion !== ACCESS_TOKEN_VERSION) {
                return res.status(401).json({ message: 'Token has expired' });
            }
            const user = await buildAuthenticatedUser({
                sub: decoded.sub,
                givenName: decoded.givenName,
                surname: decoded.surname,
                title: decoded.title,
                employeeTypes: Array.isArray(decoded.employeeTypes) ? decoded.employeeTypes : [],
                affiliations: Array.isArray(decoded.affiliations) ? decoded.affiliations : [],
                memberOf: Array.isArray(decoded.memberOf) ? decoded.memberOf : [],
            });
            return res.status(200).json(toSessionResponse(user, 'Token is valid'));
        } catch (e) {
            return res.status(401).json({ message: 'Token has expired' });
        }
    }
}
