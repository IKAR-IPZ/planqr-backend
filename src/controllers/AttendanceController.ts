import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { env } from '../config/env';

const prisma = new PrismaClient();

type AttendanceSessionRecord = {
    id: number;
    username: string;
    cardHex: string;
    openedAt: Date;
    closedAt: Date | null;
    status: string | null;
    isActive: number;
    createdAt: Date | null;
    updatedAt: Date | null;
};

type AttendanceUserRecord = {
    id: number;
    username: string;
    cardHex: string;
    lastAccess: Date;
    status: string | null;
    dydaktykId: number | null;
    createdAt: Date | null;
    updatedAt: Date | null;
};

type AttendanceSessionWithUsers = AttendanceSessionRecord & {
    users: AttendanceUserRecord[];
};

const attendanceSessionClient = (prisma as unknown as {
    tblDydaktyk: {
        create: (args: { data: Record<string, unknown> }) => Promise<AttendanceSessionRecord>;
        findFirst: (args: Record<string, unknown>) => Promise<AttendanceSessionRecord | null>;
        findMany: (args: Record<string, unknown>) => Promise<AttendanceSessionRecord[]>;
        update: (args: {
            where: { id: number };
            data: Record<string, unknown>;
        }) => Promise<AttendanceSessionRecord>;
    };
}).tblDydaktyk;

const attendanceUserClient = (prisma as unknown as {
    tblUser: {
        create: (args: { data: Record<string, unknown> }) => Promise<AttendanceUserRecord>;
        findFirst: (args: Record<string, unknown>) => Promise<AttendanceUserRecord | null>;
        findMany: (args: Record<string, unknown>) => Promise<AttendanceUserRecord[]>;
        update: (args: {
            where: { id: number };
            data: Record<string, unknown>;
        }) => Promise<AttendanceUserRecord>;
        updateMany: (args: {
            where: Record<string, unknown>;
            data: Record<string, unknown>;
        }) => Promise<{ count: number }>;
    };
}).tblUser;

const scanSchema = z.object({
    card_id: z.string().min(1).optional(),
    card_hex: z.string().min(1).optional(),
    username: z.string().min(1).optional(),
    door_id: z.string().min(1).optional(),
    doorId: z.string().min(1).optional(),
    scanned_at: z.string().datetime().optional(),
    role: z.enum(['dydaktyk', 'lecturer', 'teacher', 'student', 'user']).optional(),
}).superRefine((value, ctx) => {
    if (!value.card_id && !value.card_hex) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['card_hex'],
            message: 'card_hex or card_id is required',
        });
    }
});

const attendanceListQuerySchema = z.object({
    session_id: z.coerce.number().int().positive().optional(),
    sessionId: z.coerce.number().int().positive().optional(),
    door_id: z.string().min(1).optional(),
    doorId: z.string().min(1).optional(),
    from: z.string().datetime().optional(),
    to: z.string().datetime().optional(),
});

const sessionBodySchema = z.object({
    username: z.string().min(1),
    card_hex: z.string().min(1).optional(),
    card_id: z.string().min(1).optional(),
    door_id: z.string().min(1).optional(),
    doorId: z.string().min(1).optional(),
    opened_at: z.string().datetime().optional(),
}).superRefine((value, ctx) => {
    if (!value.card_hex && !value.card_id) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['card_hex'],
            message: 'card_hex or card_id is required',
        });
    }
});

const manualUserSchema = z.object({
    username: z.string().min(1),
    card_hex: z.string().min(1).optional(),
    card_id: z.string().min(1).optional(),
    last_access: z.string().datetime().optional(),
    entered_at: z.string().min(1).optional(),
}).superRefine((value, ctx) => {
    if (!value.card_hex && !value.card_id && !value.username) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['card_hex'],
            message: 'card_hex, card_id, or username is required',
        });
    }
});

const idParamsSchema = z.object({
    id: z.coerce.number().int().positive(),
});

const userIdParamsSchema = z.object({
    id: z.coerce.number().int().positive(),
    userId: z.coerce.number().int().positive(),
});

const MAX_ATTENDANCE_SESSION_LIMIT = 500;

const normalizeText = (value?: string | null) => String(value ?? '').trim();
const normalizeCardHex = (value?: string | null) => normalizeText(value).toUpperCase();
const toIsoString = (value: Date) => value.toISOString();
const toNullableIsoString = (value?: Date | null) => (value ? value.toISOString() : null);

const toAttendanceTime = (value: Date) =>
    new Intl.DateTimeFormat('pl-PL', {
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
        timeZone: 'Europe/Warsaw',
    }).format(value);

const getAuthenticatedLecturerId = (req: Request) => {
    const user = (req as Request & { user?: { login?: string } }).user;
    return user?.login ?? null;
};

const getCardHex = (value: { card_hex?: string; card_id?: string }) =>
    normalizeCardHex(value.card_hex ?? value.card_id);

const getTimestamp = (value?: string) => {
    const timestamp = value ? new Date(value) : new Date();
    return Number.isNaN(timestamp.getTime()) ? new Date() : timestamp;
};

const buildSessionWhere = (activeOnly = true): Record<string, unknown> => activeOnly
    ? {
        isActive: 1,
        status: 'open',
    }
    : {};

const findActiveSessionForCard = async (cardHex: string) =>
    attendanceSessionClient.findFirst({
        where: {
            cardHex,
            ...buildSessionWhere(),
        },
        orderBy: { openedAt: 'desc' },
    });

const findActiveSession = async () =>
    attendanceSessionClient.findFirst({
        where: buildSessionWhere(),
        orderBy: { openedAt: 'desc' },
    });

const findLatestSession = async () =>
    attendanceSessionClient.findFirst({
        where: buildSessionWhere(false),
        orderBy: { openedAt: 'desc' },
    });

const getSessionUsers = async (sessionId: number) =>
    attendanceUserClient.findMany({
        where: { dydaktykId: sessionId },
        orderBy: { lastAccess: 'asc' },
    });

const attachUsersToSession = async (
    session: AttendanceSessionRecord,
): Promise<AttendanceSessionWithUsers> => ({
    ...session,
    users: await getSessionUsers(session.id),
});

const detachSessionUsers = async (sessionId: number, updatedAt: Date) =>
    attendanceUserClient.updateMany({
        where: { dydaktykId: sessionId },
        data: {
            dydaktykId: null,
            updatedAt,
        },
    });

const findSessionForList = async (sessionId?: number) => {
    if (sessionId) {
        const session = await attendanceSessionClient.findFirst({
            where: { id: sessionId },
        });

        return session ? attachUsersToSession(session) : null;
    }

    const activeSession = await findActiveSession();
    if (activeSession) {
        return attachUsersToSession(activeSession);
    }

    const latestSession = await findLatestSession();
    return latestSession ? attachUsersToSession(latestSession) : null;
};

const serializeAttendanceUser = (user: AttendanceUserRecord) => ({
    id: user.id,
    userId: user.id,
    studentId: user.cardHex,
    albumNumber: user.username || user.cardHex,
    username: user.username,
    cardHex: user.cardHex,
    present: true,
    source: user.status === 'manual' ? 'manual' : 'scanner',
    status: user.status ?? 'scanner',
    firstScannedAt: toIsoString(user.lastAccess),
    lastScannedAt: toIsoString(user.lastAccess),
    lastAccess: toIsoString(user.lastAccess),
    enteredAt: toAttendanceTime(user.lastAccess),
    scanCount: 1,
});

const serializeAttendanceList = (
    session: AttendanceSessionWithUsers,
    lecturerId: string | null,
) => {
    const students = session.users.map(serializeAttendanceUser);

    return {
        status: session.status ?? (session.isActive ? 'open' : 'closed'),
        sessionId: session.id,
        dydaktykId: session.id,
        lecturerId,
        lecturerUsername: session.username,
        lecturerCardHex: session.cardHex,
        doorId: null,
        openedAt: toIsoString(session.openedAt),
        closedAt: toNullableIsoString(session.closedAt),
        from: toIsoString(session.openedAt),
        to: session.closedAt ? toIsoString(session.closedAt) : new Date().toISOString(),
        generatedAt: new Date().toISOString(),
        totalScans: students.length,
        totalPresent: students.length,
        truncated: false,
        students,
    };
};

const serializeSessionSummary = (session: AttendanceSessionRecord) => ({
    id: session.id,
    sessionId: session.id,
    username: session.username,
    cardHex: session.cardHex,
    doorId: null,
    openedAt: toIsoString(session.openedAt),
    closedAt: toNullableIsoString(session.closedAt),
    status: session.status ?? (session.isActive ? 'open' : 'closed'),
    isActive: session.isActive,
    createdAt: toNullableIsoString(session.createdAt),
    updatedAt: toNullableIsoString(session.updatedAt),
});

const openSessionRecord = async (
    username: string,
    cardHex: string,
    openedAt: Date,
): Promise<AttendanceSessionRecord> => {
    const normalizedUsername = normalizeText(username) || cardHex;
    const now = new Date();
    const existingSession = await attendanceSessionClient.findFirst({
        where: { username: normalizedUsername },
    });

    if (existingSession) {
        await detachSessionUsers(existingSession.id, now);

        return attendanceSessionClient.update({
            where: { id: existingSession.id },
            data: {
                username: normalizedUsername,
                cardHex,
                openedAt,
                closedAt: null,
                status: 'open',
                isActive: 1,
                updatedAt: now,
            },
        });
    }

    return attendanceSessionClient.create({
        data: {
            username: normalizedUsername,
            cardHex,
            openedAt,
            status: 'open',
            isActive: 1,
        },
    });
};

const closeAttendanceSessionRecord = async (
    session: AttendanceSessionRecord,
    closedAt: Date,
    status = 'closed',
) => {
    const updatedSession = await attendanceSessionClient.update({
        where: { id: session.id },
        data: {
            closedAt,
            status,
            isActive: 0,
            updatedAt: new Date(),
        },
    });

    return attachUsersToSession(updatedSession);
};

const addOrUpdateSessionUser = async (
    session: AttendanceSessionRecord,
    username: string,
    cardHex: string,
    lastAccess: Date,
    status = 'scanner',
) => {
    const normalizedUsername = normalizeText(username) || cardHex;
    const now = new Date();
    const existingUser = await attendanceUserClient.findFirst({
        where: {
            username: normalizedUsername,
            cardHex,
        },
    });

    if (existingUser) {
        return attendanceUserClient.update({
            where: { id: existingUser.id },
            data: {
                username: normalizedUsername,
                lastAccess,
                status,
                dydaktykId: session.id,
                updatedAt: now,
            },
        });
    }

    return attendanceUserClient.create({
        data: {
            username: normalizedUsername,
            cardHex,
            lastAccess,
            status,
            dydaktykId: session.id,
        },
    });
};

const getManualAccessDate = (session: AttendanceSessionRecord, value: {
    last_access?: string;
    entered_at?: string;
}) => {
    if (value.last_access) {
        return getTimestamp(value.last_access);
    }

    const enteredAt = normalizeText(value.entered_at);
    const timeMatch = enteredAt.match(/^(\d{1,2}):(\d{2})$/);
    if (!timeMatch) {
        return new Date();
    }

    const hours = Number.parseInt(timeMatch[1], 10);
    const minutes = Number.parseInt(timeMatch[2], 10);
    const accessDate = new Date(session.openedAt);
    accessDate.setHours(hours, minutes, 0, 0);

    return accessDate;
};

export class AttendanceController {
    private static isValidToken(authHeader: string | undefined): boolean {
        if (!authHeader || !authHeader.startsWith('Bearer ')) return false;
        const token = authHeader.split(' ')[1];
        return Boolean(env.WORKER_SECRET_TOKEN) && token === env.WORKER_SECRET_TOKEN;
    }

    // POST /api/attendance/scan
    static async recordScan(req: Request, res: Response): Promise<void> {
        try {
            if (!env.WORKER_SECRET_TOKEN) {
                res.status(503).json({ status: 'error', message: 'Attendance worker token is not configured' });
                return;
            }

            if (!AttendanceController.isValidToken(req.headers.authorization)) {
                res.status(401).json({ status: 'error', message: 'Unauthorized' });
                return;
            }

            const parseResult = scanSchema.safeParse(req.body);
            if (!parseResult.success) {
                res.status(400).json({
                    status: 'error',
                    message: 'Invalid request body format',
                    errors: parseResult.error.errors,
                });
                return;
            }

            const cardHex = getCardHex(parseResult.data);
            const username = normalizeText(parseResult.data.username) || cardHex;
            const scannedAt = getTimestamp(parseResult.data.scanned_at);
            const role = parseResult.data.role;

            if (role === 'dydaktyk' || role === 'lecturer' || role === 'teacher') {
                const activeOwnSession = await findActiveSessionForCard(cardHex);

                if (activeOwnSession) {
                    const closedSession = await closeAttendanceSessionRecord(activeOwnSession, scannedAt);
                    res.status(200).json({
                        status: 'success',
                        action: 'closed',
                        session: serializeAttendanceList(closedSession, null),
                    });
                    return;
                }

                const session = await openSessionRecord(username, cardHex, scannedAt);
                res.status(201).json({
                    status: 'success',
                    action: 'opened',
                    session: serializeSessionSummary(session),
                });
                return;
            }

            const activeOwnSession = await findActiveSessionForCard(cardHex);
            if (activeOwnSession) {
                const closedSession = await closeAttendanceSessionRecord(activeOwnSession, scannedAt);
                res.status(200).json({
                    status: 'success',
                    action: 'closed',
                    session: serializeAttendanceList(closedSession, null),
                });
                return;
            }

            const activeSession = await findActiveSession();
            if (activeSession) {
                const user = await addOrUpdateSessionUser(activeSession, username, cardHex, scannedAt);
                res.status(201).json({
                    status: 'success',
                    action: 'recorded',
                    sessionId: activeSession.id,
                    user: serializeAttendanceUser(user),
                });
                return;
            }

            if (role === 'student' || role === 'user') {
                res.status(409).json({
                    status: 'error',
                    message: 'No active attendance session for this reader',
                });
                return;
            }

            const session = await openSessionRecord(username, cardHex, scannedAt);
            res.status(201).json({
                status: 'success',
                action: 'opened',
                session: serializeSessionSummary(session),
            });
        } catch (error) {
            console.error('Error recording attendance scan:', error);
            res.status(500).json({ status: 'error', message: 'Internal server error' });
        }
    }

    // GET /api/attendance
    static async getSessions(req: Request, res: Response): Promise<void> {
        try {
            const { active, limit = '100' } = req.query;
            const parsedLimit = parseInt(limit as string, 10);
            const safeLimit = Number.isNaN(parsedLimit)
                ? 100
                : Math.max(1, Math.min(parsedLimit, MAX_ATTENDANCE_SESSION_LIMIT));
            const whereClause: Record<string, unknown> = {};

            if (active === 'true' || active === '1') {
                whereClause.isActive = 1;
                whereClause.status = 'open';
            }

            const sessions = await attendanceSessionClient.findMany({
                where: whereClause,
                orderBy: { openedAt: 'desc' },
                take: safeLimit,
            });

            res.status(200).json({
                status: 'success',
                sessions: sessions.map(serializeSessionSummary),
            });
        } catch (error) {
            console.error('Error fetching attendance sessions:', error);
            res.status(500).json({ status: 'error', message: 'Internal server error' });
        }
    }

    // POST /api/attendance/sessions
    static async openSession(req: Request, res: Response): Promise<void> {
        try {
            const parseResult = sessionBodySchema.safeParse(req.body);
            if (!parseResult.success) {
                res.status(400).json({
                    status: 'error',
                    message: 'Invalid request body format',
                    errors: parseResult.error.errors,
                });
                return;
            }

            const cardHex = getCardHex(parseResult.data);
            const openedAt = getTimestamp(parseResult.data.opened_at);

            const activeOwnSession = await findActiveSessionForCard(cardHex);

            if (activeOwnSession) {
                res.status(200).json({
                    status: 'success',
                    action: 'already_open',
                    session: serializeSessionSummary(activeOwnSession),
                });
                return;
            }

            const session = await openSessionRecord(parseResult.data.username.trim(), cardHex, openedAt);
            res.status(201).json({
                status: 'success',
                action: 'opened',
                session: serializeSessionSummary(session),
            });
        } catch (error) {
            console.error('Error opening attendance session:', error);
            res.status(500).json({ status: 'error', message: 'Internal server error' });
        }
    }

    // POST /api/attendance/sessions/:id/close
    static async closeSession(req: Request, res: Response): Promise<void> {
        try {
            const parseResult = idParamsSchema.safeParse(req.params);
            if (!parseResult.success) {
                res.status(400).json({ status: 'error', message: 'Invalid session id' });
                return;
            }

            const session = await attendanceSessionClient.findFirst({
                where: { id: parseResult.data.id },
            });

            if (!session) {
                res.status(404).json({ status: 'error', message: 'Attendance session not found' });
                return;
            }

            const closedSession = await closeAttendanceSessionRecord(session, new Date());
            res.status(200).json(serializeAttendanceList(closedSession, getAuthenticatedLecturerId(req)));
        } catch (error) {
            console.error('Error closing attendance session:', error);
            res.status(500).json({ status: 'error', message: 'Internal server error' });
        }
    }

    // POST /api/attendance/sessions/:id/send
    static async sendSession(req: Request, res: Response): Promise<void> {
        try {
            const parseResult = idParamsSchema.safeParse(req.params);
            if (!parseResult.success) {
                res.status(400).json({ status: 'error', message: 'Invalid session id' });
                return;
            }

            const session = await attendanceSessionClient.findFirst({
                where: { id: parseResult.data.id },
            });

            if (!session) {
                res.status(404).json({ status: 'error', message: 'Attendance session not found' });
                return;
            }

            const sentSession = await closeAttendanceSessionRecord(session, session.closedAt ?? new Date(), 'sent');
            res.status(200).json(serializeAttendanceList(sentSession, getAuthenticatedLecturerId(req)));
        } catch (error) {
            console.error('Error sending attendance session:', error);
            res.status(500).json({ status: 'error', message: 'Internal server error' });
        }
    }

    // POST /api/attendance/sessions/:id/users
    static async addSessionUser(req: Request, res: Response): Promise<void> {
        try {
            const paramsResult = idParamsSchema.safeParse(req.params);
            const bodyResult = manualUserSchema.safeParse(req.body);
            if (!paramsResult.success || !bodyResult.success) {
                res.status(400).json({
                    status: 'error',
                    message: 'Invalid attendance user payload',
                    errors: bodyResult.success ? undefined : bodyResult.error.errors,
                });
                return;
            }

            const session = await attendanceSessionClient.findFirst({
                where: { id: paramsResult.data.id },
            });

            if (!session) {
                res.status(404).json({ status: 'error', message: 'Attendance session not found' });
                return;
            }

            if (!session.isActive) {
                res.status(409).json({ status: 'error', message: 'Attendance session is closed' });
                return;
            }

            const cardHex = getCardHex({
                card_hex: bodyResult.data.card_hex ?? bodyResult.data.username,
                card_id: bodyResult.data.card_id,
            });
            const user = await addOrUpdateSessionUser(
                session,
                bodyResult.data.username.trim(),
                cardHex,
                getManualAccessDate(session, bodyResult.data),
                'manual',
            );

            res.status(201).json({
                status: 'success',
                user: serializeAttendanceUser(user),
            });
        } catch (error) {
            console.error('Error adding attendance user:', error);
            res.status(500).json({ status: 'error', message: 'Internal server error' });
        }
    }

    // DELETE /api/attendance/sessions/:id/users/:userId
    static async removeSessionUser(req: Request, res: Response): Promise<void> {
        try {
            const parseResult = userIdParamsSchema.safeParse(req.params);
            if (!parseResult.success) {
                res.status(400).json({ status: 'error', message: 'Invalid attendance user id' });
                return;
            }

            const session = await attendanceSessionClient.findFirst({
                where: { id: parseResult.data.id },
            });

            if (!session) {
                res.status(404).json({ status: 'error', message: 'Attendance session not found' });
                return;
            }

            if (!session.isActive) {
                res.status(409).json({ status: 'error', message: 'Attendance session is closed' });
                return;
            }

            const user = await attendanceUserClient.findFirst({
                where: {
                    id: parseResult.data.userId,
                    dydaktykId: session.id,
                },
            });

            if (!user) {
                res.status(404).json({ status: 'error', message: 'Attendance user not found' });
                return;
            }

            await attendanceUserClient.update({
                where: { id: user.id },
                data: {
                    dydaktykId: null,
                    updatedAt: new Date(),
                },
            });
            res.status(204).send();
        } catch (error) {
            console.error('Error removing attendance user:', error);
            res.status(500).json({ status: 'error', message: 'Internal server error' });
        }
    }

    // GET /api/attendance/list?session_id=...
    static async getAttendanceList(req: Request, res: Response): Promise<void> {
        try {
            const parseResult = attendanceListQuerySchema.safeParse(req.query);
            if (!parseResult.success) {
                res.status(400).json({
                    status: 'error',
                    message: 'Invalid query parameters',
                    errors: parseResult.error.errors,
                });
                return;
            }

            const sessionId = parseResult.data.session_id ?? parseResult.data.sessionId;
            const session = await findSessionForList(sessionId);

            if (!session) {
                res.status(404).json({
                    status: 'error',
                    message: 'Attendance session not found',
                });
                return;
            }

            res.status(200).json(serializeAttendanceList(session, getAuthenticatedLecturerId(req)));
        } catch (error) {
            console.error('Error building attendance list:', error);
            res.status(500).json({ status: 'error', message: 'Internal server error' });
        }
    }
}
