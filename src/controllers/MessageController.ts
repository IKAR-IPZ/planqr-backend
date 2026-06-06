import { Request, Response } from 'express';
import { DeviceList, Message, PrismaClient } from '@prisma/client';
import { AuthRequest } from '../middlewares/authMiddleware';
import { sendTabletCommandToDevice } from '../services/tabletStreamService';

const prisma = new PrismaClient();

const sanitizeRoomValue = (value: string) => value.trim().replace(/\s+/g, ' ');
const MAX_MESSAGE_BODY_LENGTH = 2000;
const MAX_METADATA_TEXT_LENGTH = 120;

const normalizeRoomKey = (value?: string | null) => sanitizeRoomValue(value ?? '').toLowerCase();

const getRoomLabelKey = (value?: string | null) => {
    const normalized = normalizeRoomKey(value);
    const separatorIndex = normalized.indexOf(' ');
    return separatorIndex === -1 ? normalized : normalized.slice(separatorIndex + 1).trim();
};

const messageMatchesDeviceRoom = (messageRoom: string, deviceRoom?: string | null) => {
    const messageRoomKey = normalizeRoomKey(messageRoom);
    const deviceRoomKey = normalizeRoomKey(deviceRoom);

    if (!messageRoomKey || !deviceRoomKey) {
        return false;
    }

    return (
        messageRoomKey === deviceRoomKey ||
        messageRoomKey === getRoomLabelKey(deviceRoom) ||
        getRoomLabelKey(messageRoom) === deviceRoomKey
    );
};

const notifyTabletsAboutMessageChange = async (
    message: Pick<Message, 'lessonId' | 'room' | 'newRoom'>,
    action: 'created' | 'updated' | 'deleted'
) => {
    const roomsToNotify = Array.from(
        new Set(
            [message.room, message.newRoom]
                .map((room) => sanitizeRoomValue(room ?? ''))
                .filter(Boolean)
        )
    );

    if (roomsToNotify.length === 0) {
        return;
    }

    try {
        const devices = await prisma.deviceList.findMany({
            where: {
                status: 'ACTIVE',
                deviceClassroom: {
                    not: null
                }
            }
        });

        const matchingDevices = devices.filter((device: DeviceList) =>
            roomsToNotify.some((room) => messageMatchesDeviceRoom(room, device.deviceClassroom))
        );

        let delivered = 0;
        for (const device of matchingDevices) {
            delivered += sendTabletCommandToDevice(device.deviceId, {
                type: 'messages-updated',
                issuedAt: new Date().toISOString(),
                reason: `message-${action}`,
                room: device.deviceClassroom,
                lessonId: message.lessonId
            });
        }

        if (matchingDevices.length > 0) {
            console.info(
                `[Messages] Notified ${delivered}/${matchingDevices.length} tablet stream(s) ` +
                `about ${action} message for lesson ${message.lessonId}.`
            );
        }
    } catch (error) {
        console.error('[Messages] Failed to notify tablets about message change:', error);
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

            const nextBody = typeof command.body === 'string' ? command.body.trim() : '';
            if (!nextBody || nextBody.length > MAX_MESSAGE_BODY_LENGTH) {
                res.status(400).json({ message: 'Message body is required and must not exceed 2000 characters' });
                return;
            }

            const room = typeof command.room === 'string' ? command.room.trim() : '';
            const group = typeof command.group === 'string' ? command.group.trim() : '';
            const newRoom = typeof command.newRoom === 'string' ? sanitizeRoomValue(command.newRoom) : '';

            if (
                room.length > MAX_METADATA_TEXT_LENGTH ||
                group.length > MAX_METADATA_TEXT_LENGTH ||
                newRoom.length > MAX_METADATA_TEXT_LENGTH
            ) {
                res.status(400).json({ message: 'Room, group and new room values must not exceed 120 characters' });
                return;
            }

            const lecturerName = req.user.displayName || command.lecturer || 'System';
            const message = await prisma.message.create({
                data: {
                    body: nextBody,
                    lecturer: lecturerName,
                    login: req.user.login,
                    room: room || 'Unknown',
                    lessonId: parsedLessonId,
                    group: group || 'All',
                    isRoomChange: Boolean(command.isRoomChange),
                    newRoom: newRoom || null,
                    createdAt: command.createdAt ? new Date(command.createdAt) : new Date()
                } as any
            });
            console.log(`Received message from ${req.user.login} for lesson ${parsedLessonId}`);
            await notifyTabletsAboutMessageChange(message, 'created');
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
        if (!Number.isInteger(lessonId) || lessonId <= 0) {
            res.status(400).json({ message: 'Invalid lesson id' });
            return;
        }

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

            if (nextBody.length > MAX_MESSAGE_BODY_LENGTH || nextRoom.length > MAX_METADATA_TEXT_LENGTH) {
                res.status(400).json({ message: 'Message body or room value is too long' });
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

                const updatedMessage = await prisma.message.update({
                    where: { id },
                    data: {
                        newRoom: nextRoom,
                        body: `Zajęcia przeniesione do sali: ${nextRoom}`,
                    },
                });

                await notifyTabletsAboutMessageChange(updatedMessage, 'updated');
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

            await notifyTabletsAboutMessageChange(updatedMessage, 'updated');
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
            await notifyTabletsAboutMessageChange(existingMessage, 'deleted');
            res.sendStatus(204);
        } catch (e) {
            res.sendStatus(404);
        }
    }
}
