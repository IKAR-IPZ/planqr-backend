import { Request, Response } from 'express';
import { LdapService } from '../services/LdapService';
import jwt from 'jsonwebtoken';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const ldapService = new LdapService();
const JWT_SECRET = process.env.JWT_SECRET || 'supersecret';
const ISSUER = "PlanQR_Issuer";
const AUDIENCE = "PlanQR_Audience";

export class AuthController {

    static async login(req: Request, res: Response) {
        console.log(`Login request received. NODE_ENV=${process.env.NODE_ENV}, Origin=${req.headers.origin}, Cookies=${JSON.stringify(req.cookies)}`);
        try {
            const { username, password } = req.body;

            if (!username) {
                return res.status(400).json({ message: 'Invalid request' });
            }

            // Authenticate user via LDAP service
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
                    JWT_SECRET,
                    {
                        expiresIn: '24h',
                        issuer: ISSUER,
                        audience: AUDIENCE
                    }
                );

                res.cookie('jwt', token, {
                    httpOnly: true,
                    secure: process.env.NODE_ENV === 'production',
                    sameSite: process.env.NODE_ENV === 'production' ? 'strict' : 'lax'
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
            const decoded = jwt.verify(token, JWT_SECRET) as any;
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
            const decoded = jwt.verify(token, JWT_SECRET) as any;
            return res.status(200).json({ message: 'Token is valid', username: decoded.sub });
        } catch (e) {
            return res.status(401).json({ message: 'Token has expired' });
        }
    }
}
