import { NextFunction, Request, Response, Router } from 'express';
import { AttendanceController } from '../controllers/AttendanceController';
import { requireLecturerAccess } from '../middlewares/authMiddleware';
import { attendanceScanRateLimiter } from '../middlewares/securityMiddleware';
import { env } from '../config/env';

const router = Router();

const hasValidServiceToken = (authHeader: string | undefined) => {
    if (!authHeader?.startsWith('Bearer ')) {
        return false;
    }

    const token = authHeader.split(' ')[1];
    return Boolean(env.WORKER_SECRET_TOKEN) && token === env.WORKER_SECRET_TOKEN;
};

const requireLecturerOrServiceAccess = (req: Request, res: Response, next: NextFunction) => {
    if (hasValidServiceToken(req.headers.authorization)) {
        next();
        return;
    }

    void requireLecturerAccess(req, res, next);
};

/**
 * @swagger
 * tags:
 *   name: Attendance
 *   description: Attendance tracking (Kantech edge worker)
 */

/**
 * @swagger
 * /api/attendance/scan:
 *   post:
 *     summary: Open/close an attendance session or add a user from a card scan
 *     tags: [Attendance]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               card_id:
 *                 type: string
 *               card_hex:
 *                 type: string
 *               username:
 *                 type: string
 *               door_id:
 *                 type: string
 *                 deprecated: true
 *               scanned_at:
 *                 type: string
 *                 format: date-time
 *               role:
 *                 type: string
 *                 enum: [dydaktyk, lecturer, teacher, student, user]
 *     responses:
 *       201:
 *         description: Scan recorded
 *       400:
 *         description: Invalid payload
 *       401:
 *         description: Unauthorized
 */
// eslint-disable-next-line @typescript-eslint/no-misused-promises
router.post('/scan', attendanceScanRateLimiter, AttendanceController.recordScan);

/**
 * @swagger
 * /api/attendance/list:
 *   get:
 *     summary: Get persisted attendance JSON for the latest/open session
 *     tags: [Attendance]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: session_id
 *         schema:
 *           type: integer
 *         description: Explicit attendance session id
 *       - in: query
 *         name: door_id
 *         schema:
 *           type: string
 *         deprecated: true
 *         description: Accepted for backward compatibility; sessions are no longer stored by door
 *     responses:
 *       200:
 *         description: Student attendance JSON
 *       400:
 *         description: Invalid query parameters
 *       401:
 *         description: Unauthorized
 */
// eslint-disable-next-line @typescript-eslint/no-misused-promises
router.get('/list', requireLecturerOrServiceAccess, AttendanceController.getAttendanceList);

// eslint-disable-next-line @typescript-eslint/no-misused-promises
router.post('/sessions', requireLecturerAccess, AttendanceController.openSession);

// eslint-disable-next-line @typescript-eslint/no-misused-promises
router.post('/sessions/:id/close', requireLecturerAccess, AttendanceController.closeSession);

// eslint-disable-next-line @typescript-eslint/no-misused-promises
router.post('/sessions/:id/send', requireLecturerOrServiceAccess, AttendanceController.sendSession);

// eslint-disable-next-line @typescript-eslint/no-misused-promises
router.post('/sessions/:id/users', requireLecturerAccess, AttendanceController.addSessionUser);

// eslint-disable-next-line @typescript-eslint/no-misused-promises
router.delete('/sessions/:id/users/:userId', requireLecturerAccess, AttendanceController.removeSessionUser);

/**
 * @swagger
 * /api/attendance:
 *   get:
 *     summary: Get a list of attendance sessions
 *     tags: [Attendance]
 *     parameters:
 *       - in: query
 *         name: active
 *         schema:
 *           type: boolean
 *         description: Return only active sessions
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *         description: Number of records to return
 *     responses:
 *       200:
 *         description: List of attendance sessions
 */
// eslint-disable-next-line @typescript-eslint/no-misused-promises
router.get('/', requireLecturerAccess, AttendanceController.getSessions);

export default router;
