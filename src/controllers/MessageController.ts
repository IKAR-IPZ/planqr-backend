import axios from 'axios';
import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { AuthRequest } from '../middlewares/authMiddleware';
import { env } from '../config/env';

const prisma = new PrismaClient();
const ROOM_SEARCH_URL = env.ZUT_SCHEDULE_STUDENT_URL.replace(
    /schedule_student\.php$/i,
    'schedule.php'
);

const sanitizeRoomValue = (value: string) => value.trim().replace(/\s+/g, ' ');
const normalizeRoomValue = (value: string) => sanitizeRoomValue(value).toUpperCase();

const fetchMatchingRooms = async (query: string) => {
    const response = await axios.get(ROOM_SEARCH_URL, {
        params: {
            kind: 'room',
            query: sanitizeRoomValue(query)
        },
        headers: { 'User-Agent': 'Mozilla/5.0' }
    });

    const data = response.data;
    return Array.isArray(data)
        ? Array.from(
            new Set(
                data
                    .filter((item: { item?: unknown }) => typeof item?.item === 'string')
                    .map((item: { item: string }) => sanitizeRoomValue(item.item))
                    .filter(Boolean)
            )
        )
        : [];
};

const isValidRoom = async (roomName: string) => {
    const normalizedRoom = normalizeRoomValue(roomName);
    if (!normalizedRoom) {
        return false;
    }

    try {
        const rooms = await fetchMatchingRooms(roomName);
        return rooms.some((room) => normalizeRoomValue(room) === normalizedRoom);
    } catch (error) {
        console.error('Failed to validate room for message update:', error);
        return false;
    }
};

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
                where: { lessonId },
                orderBy: { createdAt: 'desc' }
            });
            res.json(messages);
        } catch (e) {
            res.status(500).send("Error");
        }
    }

    // GET /api/messages
    static async getAllMessages(req: Request, res: Response) {
        try {
            const messages = await prisma.message.findMany({
                orderBy: { createdAt: 'desc' }
            });
            res.json(messages);
        } catch (e) {
            res.status(500).send("Error");
        }
    }

    // PATCH /api/messages/{id}
    static async updateMessage(req: AuthRequest, res: Response) {
        const id = parseInt(req.params.id);
        const nextBody =
            typeof req.body?.body === 'string' ? req.body.body.trim() : '';
        const nextRoom =
            typeof req.body?.newRoom === 'string'
                ? sanitizeRoomValue(req.body.newRoom)
                : '';

        try {
            if (!req.user) {
                res.status(401).json({ message: 'Authentication required' });
                return;
            }

            if (!Number.isInteger(id) || id <= 0) {
                res.status(400).json({ message: 'Invalid message id' });
                return;
            }

            if (!nextBody && !nextRoom) {
                res.status(400).json({ message: 'Message body or newRoom is required' });
                return;
            }

            const existingMessage = await prisma.message.findUnique({ where: { id } });

            if (!existingMessage) {
                res.sendStatus(404);
                return;
            }

            if (!req.user.isAdmin && existingMessage.login !== req.user.login) {
                res.status(403).json({ message: 'You can only edit your own messages' });
                return;
            }

            if (existingMessage.isRoomChange) {
                if (!nextRoom) {
                    res.status(400).json({ message: 'newRoom is required for room change messages' });
                    return;
                }

                const roomExists = await isValidRoom(nextRoom);
                if (!roomExists) {
                    res.status(400).json({ message: 'Selected room does not exist in schedule data' });
                    return;
                }

                const updatedMessage = await prisma.message.update({
                    where: { id },
                    data: {
                        newRoom: nextRoom,
                        body: `Zajęcia przeniesione do sali: ${nextRoom}`,
                    },
                });

                res.status(200).json(updatedMessage);
                return;
            }

            if (!nextBody) {
                res.status(400).json({ message: 'Message body is required' });
                return;
            }

            const updatedMessage = await prisma.message.update({
                where: { id },
                data: { body: nextBody },
            });

            res.status(200).json(updatedMessage);
        } catch (e) {
            console.error(e);
            res.status(500).send("Server Error");
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
