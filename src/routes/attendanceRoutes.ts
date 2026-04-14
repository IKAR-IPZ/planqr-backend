import { Router } from 'express';
import { AttendanceController } from '../controllers/AttendanceController';
import { requireLecturerAccess } from '../middlewares/authMiddleware';
import { attendanceScanRateLimiter } from '../middlewares/securityMiddleware';

const router = Router();

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
router.post('/scan', attendanceScanRateLimiter, AttendanceController.recordScan);

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
