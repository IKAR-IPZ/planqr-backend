import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { AuthRequest } from '../middlewares/authMiddleware';

const prisma = new PrismaClient();

export class MessageController {

    // POST /api/messages
    static async createMessage(req: AuthRequest, res: Response) {
        const command = req.body;
        if (!command) {
            res.status(400).send("Invalid request");
            return;
        }

        // Create message record
        try {
            if (!req.user) {
                res.status(401).json({ message: 'Authentication required' });
                return;
            }

            const parsedLessonId = command.lessonId ? Number(command.lessonId) : 0;
            if (!Number.isInteger(parsedLessonId) || parsedLessonId <= 0) {
                res.status(400).json({ message: 'Invalid lessonId' });
                return;
            }

            const lecturerName = req.user.displayName || command.lecturer || 'System';
            const message = await prisma.message.create({
                data: {
                    body: command.body,
                    lecturer: lecturerName,
                    login: req.user.login,
                    room: command.room || 'Unknown',
                    lessonId: parsedLessonId,
                    group: command.group || 'All',
                    isRoomChange: Boolean(command.isRoomChange),
                    newRoom: command.newRoom || null,
                    createdAt: command.createdAt ? new Date(command.createdAt) : new Date()
                } as any
            });
            console.log(`Received message: ${command.body} from ${req.user.login} for lesson ${parsedLessonId}`);
            // Return the created message
            res.status(200).json(message);
        } catch (e) {
            console.error(e);
            res.status(500).send("Server Error");
        }
    }

    // GET /api/messages/{lessonId}
    static async getMessages(req: Request, res: Response) {
        const lessonId = parseInt(req.params.lessonId);
        try {
            const messages = await prisma.message.findMany({
                where: { lessonId }
            });
            res.json(messages);
        } catch (e) {
            res.status(500).send("Error");
        }
    }

    // GET /api/messages
    static async getAllMessages(req: Request, res: Response) {
        try {
            const messages = await prisma.message.findMany();
            res.json(messages);
        } catch (e) {
            res.status(500).send("Error");
        }
    }

    // DELETE /api/messages/{id}
    static async deleteMessage(req: AuthRequest, res: Response) {
        const id = parseInt(req.params.id);
        try {
            if (!req.user) {
                res.status(401).json({ message: 'Authentication required' });
                return;
            }

            const existingMessage = await prisma.message.findUnique({ where: { id } });
            if (!existingMessage) {
                res.sendStatus(404);
                return;
            }

            if (!req.user.isAdmin && existingMessage.login !== req.user.login) {
                res.status(403).json({ message: 'You can only delete your own messages' });
                return;
            }

            await prisma.message.delete({ where: { id } });
            res.sendStatus(204);
        } catch (e) {
            res.sendStatus(404);
        }
    }
}
