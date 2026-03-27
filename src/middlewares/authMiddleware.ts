import { Request, Response, NextFunction } from 'express';
import { buildAuthenticatedUser, type AuthenticatedUser } from '../services/authAccessService';
import { decodeIdentityClaimsFromToken } from '../services/authTokenService';

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

const resolveRequestUser = async (req: AuthRequest) => {
    if (req.user) {
        return req.user;
    }

    const token = getTokenFromRequest(req);
    if (!token) {
        return null;
    }

    const identity = decodeIdentityClaimsFromToken(token);
    if (!identity) {
        throw new Error('Invalid or expired token');
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
