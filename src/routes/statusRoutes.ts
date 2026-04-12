import { Router } from 'express';
import { StatusController } from '../controllers/StatusController';

const router = Router();

/**
 * @swagger
 * tags:
 *   name: Status
 *   description: Public tablet status
 */

/**
 * @swagger
 * /status:
 *   get:
 *     summary: Get public tablet status summary
 *     tags: [Status]
 *     responses:
 *       200:
 *         description: Aggregated tablet counts and offline devices
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               required:
 *                 - total
 *                 - online
 *                 - offline
 *                 - pending
 *                 - offlineDevices
 *               properties:
 *                 total:
 *                   type: integer
 *                 online:
 *                   type: integer
 *                 offline:
 *                   type: integer
 *                 pending:
 *                   type: integer
 *                 offlineDevices:
 *                   type: array
 *                   items:
 *                     type: object
 *                     required:
 *                       - room
 *                       - lastSeen
 *                     properties:
 *                       room:
 *                         type: string
 *                         nullable: true
 *                       lastSeen:
 *                         type: string
 *                         format: date-time
 *             example:
 *               total: 12
 *               online: 7
 *               offline: 3
 *               pending: 2
 *               offlineDevices:
 *                 - room: WI1-308
 *                   lastSeen: '2026-04-12T09:14:21.000Z'
 */
router.get('/status', StatusController.getStatus);

export default router;
