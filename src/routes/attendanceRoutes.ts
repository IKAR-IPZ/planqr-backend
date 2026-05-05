import { NextFunction, Request, Response, Router } from 'express';
import { AttendanceController } from '../controllers/AttendanceController';
import { requireLecturerAccess } from '../middlewares/authMiddleware';
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
 *     summary: Record a new card scan from a door reader
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
 *               door_id:
 *                 type: string
 *               scanned_at:
 *                 type: string
 *                 format: date-time
 *     responses:
 *       201:
 *         description: Scan recorded
 *       400:
 *         description: Invalid payload
 *       401:
 *         description: Unauthorized
 */
// eslint-disable-next-line @typescript-eslint/no-misused-promises
router.post('/scan', AttendanceController.recordScan);

/**
 * @swagger
 * /api/attendance/lessons/{lessonId}/list:
 *   get:
 *     summary: Build a student attendance list for a lesson from raw scan logs
 *     tags: [Attendance]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: lessonId
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: door_id
 *         required: true
 *         schema:
 *           type: string
 *         description: Door reader id stored in attendance logs
 *       - in: query
 *         name: from
 *         required: true
 *         schema:
 *           type: string
 *           format: date-time
 *       - in: query
 *         name: to
 *         required: true
 *         schema:
 *           type: string
 *           format: date-time
 *     responses:
 *       200:
 *         description: Student attendance JSON
 *       400:
 *         description: Invalid query parameters
 *       401:
 *         description: Unauthorized
 */
// eslint-disable-next-line @typescript-eslint/no-misused-promises
router.get('/lessons/:lessonId/list', requireLecturerOrServiceAccess, AttendanceController.getLessonAttendanceList);

/**
 * @swagger
 * /api/attendance:
 *   get:
 *     summary: Get a list of attendance logs
 *     tags: [Attendance]
 *     parameters:
 *       - in: query
 *         name: door_id
 *         schema:
 *           type: string
 *         description: Filter logs by door
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *         description: Number of records to return
 *     responses:
 *       200:
 *         description: List of scans
 */
// eslint-disable-next-line @typescript-eslint/no-misused-promises
router.get('/', requireLecturerAccess, AttendanceController.getLogs);

export default router;
