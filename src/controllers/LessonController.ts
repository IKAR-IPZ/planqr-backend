import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export class LessonController {

    // GET /api/Lesson/messages/list
    static async getMessages(req: Request, res: Response) {
        try {
            // Logic: await Mediator.Send(new Get.Query());
            // Assuming this returns all messages
            const messages = await prisma.message.findMany();
            res.json(messages);
        } catch (e) {
            res.status(500).json({ error: 'Internal server error' });
        }
    }

    // GET /api/Lesson/message/:roomId
    static async getMessage(req: Request, res: Response) {
        const id = parseInt(req.params.roomId);
        try {
            const message = await prisma.message.findUnique({ where: { id } });
            if (!message) {
                res.status(404).json({ error: 'Not found' });
                return;
            }
            res.json(message);
        } catch (e) {
            res.status(500).json({ error: 'Internal server error' });
        }
    }

    // DELETE /api/Lesson/messages/clear
    static async clearMessages(req: Request, res: Response) {
        try {
            await prisma.message.deleteMany();
            res.json({ message: 'All messages cleared' });
        } catch (e) {
            res.status(500).json({ error: 'Failed to clear messages' });
        }
    }

    // DELETE /api/Lesson/message/delete/:roomId
    static async deleteMessage(req: Request, res: Response) {
        const id = parseInt(req.params.roomId);
        try {
            await prisma.message.delete({ where: { id } });
            res.sendStatus(200);
        } catch (e) {
            res.status(404).json({ error: 'Message not found' });
        }
    }
}
