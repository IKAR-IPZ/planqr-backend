import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import { buildAuthenticatedUser, type AuthenticatedUser, type IdentityClaims } from '../services/authAccessService';

const ACCESS_TOKEN_VERSION = 2;

export interface AuthRequest extends Request {
    user?: AuthenticatedUser;
}

const getTokenFromRequest = (req: Request) => {
    const bearerHeader = req.headers.authorization;
    if (bearerHeader?.startsWith('Bearer ')) {
        return bearerHeader.split(' ')[1];
    }

    return req.cookies?.jwt;
};

const decodeIdentityClaims = (token: string): IdentityClaims | null => {
    const decoded = jwt.verify(token, env.JWT_SECRET);
    if (!decoded || typeof decoded === 'string' || typeof decoded.sub !== 'string') {
        return null;
    }

    if (decoded.planqrAccessVersion !== ACCESS_TOKEN_VERSION) {
        return null;
    }

    return {
        sub: decoded.sub,
        givenName: typeof decoded.givenName === 'string' ? decoded.givenName : '',
        surname: typeof decoded.surname === 'string' ? decoded.surname : '',
        title: typeof decoded.title === 'string' ? decoded.title : '',
        employeeTypes: Array.isArray(decoded.employeeTypes)
            ? decoded.employeeTypes.map((value) => String(value))
            : [],
        affiliations: Array.isArray(decoded.affiliations)
            ? decoded.affiliations.map((value) => String(value))
            : [],
        memberOf: Array.isArray(decoded.memberOf)
            ? decoded.memberOf.map((value) => String(value))
            : [],
    };
};

const resolveRequestUser = async (req: AuthRequest) => {
    if (req.user) {
        return req.user;
    }

    const token = getTokenFromRequest(req);
    if (!token) {
        return null;
    }

    const identity = decodeIdentityClaims(token);
    if (!identity) {
        return null;
    }

    const user = await buildAuthenticatedUser(identity);
    req.user = user;
    return user;
};

export const attachOptionalUser = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        await resolveRequestUser(req);
        next();
    } catch (error) {
        next();
    }
};

export const requireAuth = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const user = await resolveRequestUser(req);
        if (!user) {
            res.status(401).json({ message: 'Authentication required' });
            return;
        }

        next();
    } catch (error) {
        res.status(401).json({ message: 'Invalid or expired token' });
    }
};

export const requireAdmin = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const user = await resolveRequestUser(req);
        if (!user) {
            res.status(401).json({ message: 'Authentication required' });
            return;
        }

        if (!user.isAdmin) {
            res.status(403).json({ message: 'Admin access required' });
            return;
        }

        next();
    } catch (error) {
        res.status(401).json({ message: 'Invalid or expired token' });
    }
};

export const requireLecturerAccess = async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const user = await resolveRequestUser(req);
        if (!user) {
            res.status(401).json({ message: 'Authentication required' });
            return;
        }

        if (!user.canAccessLecturerPlan) {
            res.status(403).json({ message: 'Lecturer access required' });
            return;
        }

        next();
    } catch (error) {
        res.status(401).json({ message: 'Invalid or expired token' });
    }
};

export const requireOwnWorkerScheduleOrAdmin = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction
) => {
    const kind = String(req.query.kind ?? 'room').toLowerCase();

    if (kind === 'room') {
        next();
        return;
    }

    try {
        const user = await resolveRequestUser(req);
        if (!user) {
            res.status(401).json({ message: 'Authentication required' });
            return;
        }

        if (kind === 'student') {
            if (!user.isAdmin) {
                res.status(403).json({ message: 'Admin access required for student schedules' });
                return;
            }

            next();
            return;
        }

        if (kind === 'worker' || kind === 'teacher') {
            if (user.isAdmin) {
                next();
                return;
            }

            if (!user.canAccessLecturerPlan) {
                res.status(403).json({ message: 'Lecturer access required' });
                return;
            }

            const requestedWorker = String(req.query.id ?? '').trim().toLowerCase();
            const ownWorker = user.displayName.trim().toLowerCase();

            if (!requestedWorker || !ownWorker || requestedWorker !== ownWorker) {
                res.status(403).json({ message: 'You can only access your own lecturer schedule' });
                return;
            }
        }

        next();
    } catch (error) {
        res.status(401).json({ message: 'Invalid or expired token' });
    }
};
