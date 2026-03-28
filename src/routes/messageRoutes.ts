import { Router } from 'express';
import { MessageController } from '../controllers/MessageController';
import { requireAdmin, requireLecturerAccess } from '../middlewares/authMiddleware';

const router = Router();

// Order matters! 
// GET / is getAll
// GET /:lessonId is getByLessonId

/**
 * @swagger
 * tags:
 *   name: Messages
 *   description: Message management
 */

/**
 * @swagger
 * /api/messages:
 *   post:
 *     summary: Create a new message
 *     tags: [Messages]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               body:
 *                 type: string
 *               lecturer:
 *                 type: string
 *               login:
 *                 type: string
 *               room:
 *                 type: string
 *               lessonId:
 *                 type: integer
 *               group:
 *                 type: string
 *     responses:
 *       200:
 *         description: Message created
 *       500:
 *         description: Server error
 */
router.post('/', requireLecturerAccess, MessageController.createMessage);

/**
 * @swagger
 * /api/messages:
 *   get:
 *     summary: Get all messages
 *     tags: [Messages]
 *     responses:
 *       200:
 *         description: List of messages
 */
router.get('/', requireAdmin, MessageController.getAllMessages);

/**
 * @swagger
 * /api/messages/{lessonId}:
 *   get:
 *     summary: Get messages for a specific lesson
 *     tags: [Messages]
 *     parameters:
 *       - in: path
 *         name: lessonId
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: List of messages for the lesson
 */
router.get('/:lessonId', MessageController.getMessages);

/**
 * @swagger
 * /api/messages/{id}:
 *   patch:
 *     summary: Update an existing message
 *     tags: [Messages]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               body:
 *                 type: string
 *     responses:
 *       200:
 *         description: Message updated
 *       403:
 *         description: You can only update your own message
 *       409:
 *         description: Room change messages are not editable
 */
router.patch('/:id', requireLecturerAccess, MessageController.updateMessage);

/**
 * @swagger
 * /api/messages/{id}:
 *   delete:
 *     summary: Delete a message
 *     tags: [Messages]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       204:
 *         description: Message deleted
 */
router.delete('/:id', requireLecturerAccess, MessageController.deleteMessage);

export default router;
