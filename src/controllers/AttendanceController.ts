import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { env } from '../config/env';

const prisma = new PrismaClient();
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
            where: Record<string, string>;
            orderBy: { scannedAt: 'desc' };
            take: number;
        }) => Promise<unknown>;
    };
}).attendanceLog;

// Schemat walidacji Zod
const scanSchema = z.object({
    card_id: z.string().min(1),
    door_id: z.string().min(1),
    scanned_at: z.string().datetime(),
});

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
}
