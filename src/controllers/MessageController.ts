import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export class MessageController {

    // POST /api/messages
    static async createMessage(req: Request, res: Response) {
        const command = req.body;
        if (!command) {
            res.status(400).send("Invalid request");
            return;
        }

        // Create message record
        try {
            const parsedLessonId = command.lessonId ? Number(command.lessonId) : 0;
            const message = await prisma.message.create({
                data: {
                    body: command.body,
                    lecturer: command.lecturer || 'System',
                    login: command.login || 'system',
                    room: command.room || 'Unknown',
                    lessonId: isNaN(parsedLessonId) ? 0 : parsedLessonId,
                    group: command.group || 'All',
                    isRoomChange: command.isRoomChange || false,
                    newRoom: command.newRoom || null,
                    createdAt: command.createdAt ? new Date(command.createdAt) : new Date()
                } as any
            });
            console.log(`Received message: ${command.body} from ${command.login} for lesson ${command.lessonId}`);
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
    static async deleteMessage(req: Request, res: Response) {
        const id = parseInt(req.params.id);
        try {
            await prisma.message.delete({ where: { id } });
            res.sendStatus(204);
        } catch (e) {
            res.sendStatus(204);
        }
    }
}
