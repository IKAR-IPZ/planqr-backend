import { Router } from 'express';
import { getPlan } from "../controllers/ScheduleController";

const router = Router();

/**
 * @swagger
 * /api/schedule:
 *   get:
 *     summary: Pobiera plan zajęć
 *     tags: [Plan]
 *     parameters:
 *       - in: query
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         example: WI-123
 *       - in: query
 *         name: kind
 *         schema:
 *           type: string
 *           enum: [room, worker, student]
 *           default: room
 *     responses:
 *       200:
 *         description: OK
 *       400:
 *         description: Brak parametru id
 *       500:
 *         description: Błąd serwera
 */
router.get('/', getPlan);

export default router;