import { Router } from 'express';
import { getPlan } from "../controllers/ScheduleController";

const router = Router();

/**
 * @swagger
 * /api/schedule:
 *   get:
 *     summary: Retrieves the schedule
 *     tags: [Schedule]
 *     parameters:
 *       - in: query
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: >
 *           The value depends on the selected search type (`kind`):
 *            - **room** – e.g., "WI WI2- 126"
 *            - **worker** – e.g., "Śliwiński Grzegorz"
 *            - **student** – e.g., "55857" (student ID number)
 *         examples:
 *           room:
 *             summary: Example room
 *             value: WI WI2- 126
 *           worker:
 *             summary: Example instructor
 *             value: Śliwiński Grzegorz
 *           student:
 *             summary: Example student ID
 *             value: "55857"
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
 *         description: Missing 'id' parameter
 *       500:
 *         description: Server error
 */
router.get('/', getPlan);

export default router;
