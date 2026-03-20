import { Request, Response } from 'express';
import { LdapService } from '../services/LdapService';
import { env } from '../config/env';
import jwt from 'jsonwebtoken';

const ldapService = new LdapService();
const ISSUER = "PlanQR_Issuer"; // From C# config likely
const AUDIENCE = "PlanQR_Audience";

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

            const { isAuthenticated, givenName = '', surname = '', title = '' } = await ldapService.authenticate(username, password as string);

            if (isAuthenticated) {
                // Generate JWT
                const token = jwt.sign(
                    {
                        sub: username,
                        givenName,
                        surname,
                        title,
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

                return res.status(200).json({
                    message: 'Login successful',
                    givenName,
                    surname,
                    title
                });
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
            return res.status(200).json({
                message: 'Logged in',
                givenName: decoded.givenName,
                surname: decoded.surname,
                title: decoded.title,
                login: decoded.sub
            });
        } catch (e) {
            return res.status(401).json({ message: 'Token has expired or is invalid' });
        }
    }

    static async validateToken(req: Request, res: Response) {
        const token = req.cookies.jwt;
        if (!token) return res.status(401).json({ message: 'Token is missing' });

        try {
            const decoded = jwt.verify(token, env.JWT_SECRET) as any;
            return res.status(200).json({ message: 'Token is valid', username: decoded.sub });
        } catch (e) {
            return res.status(401).json({ message: 'Token has expired' });
        }
    }
}
