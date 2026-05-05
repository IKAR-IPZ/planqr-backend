import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { env } from '../config/env';

const prisma = new PrismaClient();
type AttendanceLogRecord = {
    id: number;
    cardId: string;
    doorId: string;
    scannedAt: Date;
    createdAt: Date;
    processed: boolean;
};

const attendanceLogClient = (prisma as unknown as {
    attendanceLog: {
        create: (args: {
            data: {
                cardId: string;
                doorId: string;
                scannedAt: Date;
            };
        }) => Promise<unknown>;
        findMany: (args: {
            where: {
                doorId?: string;
                scannedAt?: {
                    gte?: Date;
                    lte?: Date;
                };
            };
            orderBy: { scannedAt: 'asc' | 'desc' };
            take?: number;
        }) => Promise<AttendanceLogRecord[]>;
    };
}).attendanceLog;

// Schemat walidacji Zod
const scanSchema = z.object({
    card_id: z.string().min(1),
    door_id: z.string().min(1),
    scanned_at: z.string().datetime(),
});

const attendanceListQuerySchema = z.object({
    door_id: z.string().min(1).optional(),
    doorId: z.string().min(1).optional(),
    from: z.string().datetime(),
    to: z.string().datetime(),
}).superRefine((value, ctx) => {
    if (!value.door_id && !value.doorId) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['door_id'],
            message: 'door_id is required',
        });
    }
});

const MAX_ATTENDANCE_LIST_LOGS = 5000;

const toIsoString = (value: Date) => value.toISOString();

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

export class AttendanceController {
    
    // Walidacja tokena w uproszczonej formie
    private static isValidToken(authHeader: string | undefined): boolean {
        if (!authHeader || !authHeader.startsWith('Bearer ')) return false;
        const token = authHeader.split(' ')[1];
        return Boolean(env.WORKER_SECRET_TOKEN) && token === env.WORKER_SECRET_TOKEN;
    }

    // POST /api/v1/attendance/scan
    static async recordScan(req: Request, res: Response): Promise<void> {
        try {
            if (!env.WORKER_SECRET_TOKEN) {
                res.status(503).json({ status: 'error', message: 'Attendance worker token is not configured' });
                return;
            }

            // 1. Sprawdzenie tokena
            if (!AttendanceController.isValidToken(req.headers.authorization)) {
                res.status(401).json({ status: 'error', message: 'Unauthorized' });
                return;
            }

            // 2. Walidacja formatu
            const parseResult = scanSchema.safeParse(req.body);
            if (!parseResult.success) {
                res.status(400).json({
                    status: 'error',
                    message: 'Invalid request body format',
                    errors: parseResult.error.errors,
                });
                return;
            }

            const { card_id, door_id, scanned_at } = parseResult.data;

            // 3. Zapis do bazy (obsługa konfliktu na poziomie unikalności card_id + scanned_at)
            try {
                await attendanceLogClient.create({
                    data: {
                        cardId: card_id,
                        doorId: door_id,
                        scannedAt: new Date(scanned_at),
                    },
                });

                res.status(201).json({ status: 'success', message: 'Scan recorded' });
            } catch (dbError: any) {
                // Jeśli rekord o takim (card_id, scanned_at) już istnieje
                if (dbError.code === 'P2002') {
                    // Wg specyfikacji odrzucenie spamu jest po stronie C1, 
                    // ale traktujemy to jako sukces, żeby worker nie próbował w nieskończoność
                    res.status(200).json({ status: 'success', message: 'Scan already recorded' });
                    return;
                }
                throw dbError; // Przekaż do catch(error)
            }

        } catch (error) {
            console.error('Error recording scan:', error);
            res.status(500).json({ status: 'error', message: 'Internal server error' });
        }
    }

    // GET /api/v1/attendance
    // Dla panelu front-endowego (można zabezpieczyć JWT)
    static async getLogs(req: Request, res: Response): Promise<void> {
        try {
            const { door_id, limit = '100' } = req.query;
            const parsedLimit = parseInt(limit as string, 10);

            const whereClause: any = {};
            if (door_id) {
                whereClause.doorId = String(door_id);
            }

            const logs = await attendanceLogClient.findMany({
                where: whereClause,
                orderBy: { scannedAt: 'desc' },
                take: Number.isNaN(parsedLimit) ? 100 : parsedLimit,
            });

            res.status(200).json(logs);
        } catch (error) {
            console.error('Error fetching logs:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }

    // GET /api/attendance/list?door_id=...&from=...&to=...
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

            const doorId = parseResult.data.door_id ?? parseResult.data.doorId;
            const lecturerId = getAuthenticatedLecturerId(req);
            const fromDate = new Date(parseResult.data.from);
            const toDate = new Date(parseResult.data.to);

            if (!doorId || Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime())) {
                res.status(400).json({ status: 'error', message: 'Invalid attendance window' });
                return;
            }

            if (fromDate > toDate) {
                res.status(400).json({ status: 'error', message: 'from must be before to' });
                return;
            }

            const logs = await attendanceLogClient.findMany({
                where: {
                    doorId,
                    scannedAt: {
                        gte: fromDate,
                        lte: toDate,
                    },
                },
                orderBy: { scannedAt: 'asc' },
                take: MAX_ATTENDANCE_LIST_LOGS,
            });

            const studentsById = new Map<string, {
                studentId: string;
                albumNumber: string;
                present: true;
                source: 'scanner';
                firstScannedAt: string;
                lastScannedAt: string;
                enteredAt: string;
                scanCount: number;
                attendanceLogIds: number[];
            }>();

            for (const log of logs) {
                const studentId = log.cardId.trim();
                if (!studentId) {
                    continue;
                }

                const scannedAt = toIsoString(log.scannedAt);
                const existing = studentsById.get(studentId);

                if (!existing) {
                    studentsById.set(studentId, {
                        studentId,
                        albumNumber: studentId,
                        present: true,
                        source: 'scanner',
                        firstScannedAt: scannedAt,
                        lastScannedAt: scannedAt,
                        enteredAt: toAttendanceTime(log.scannedAt),
                        scanCount: 1,
                        attendanceLogIds: [log.id],
                    });
                    continue;
                }

                existing.lastScannedAt = scannedAt;
                existing.scanCount += 1;
                existing.attendanceLogIds.push(log.id);
            }

            const students = Array.from(studentsById.values()).sort((first, second) =>
                first.firstScannedAt.localeCompare(second.firstScannedAt)
            );

            res.status(200).json({
                status: 'success',
                doorId,
                lecturerId,
                from: toIsoString(fromDate),
                to: toIsoString(toDate),
                generatedAt: new Date().toISOString(),
                totalScans: logs.length,
                totalPresent: students.length,
                truncated: logs.length === MAX_ATTENDANCE_LIST_LOGS,
                students,
            });
        } catch (error) {
            console.error('Error building lesson attendance list:', error);
            res.status(500).json({ status: 'error', message: 'Internal server error' });
        }
    }
}
