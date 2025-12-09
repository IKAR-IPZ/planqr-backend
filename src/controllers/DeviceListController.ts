import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export class DeviceListController {

    // GET /api/devices
    static async getDevices(req: Request, res: Response) {
        const devices = await prisma.deviceList.findMany();
        res.json(devices);
    }

    // GET /api/devices/{id}
    static async getDevice(req: Request, res: Response) {
        const id = parseInt(req.params.id);
        const device = await prisma.deviceList.findUnique({ where: { id } });
        if (!device) {
            res.sendStatus(404);
            return;
        }
        res.json(device);
    }

    // POST /api/devices
    static async createDevice(req: Request, res: Response) {
        const { deviceName, deviceClassroom } = req.body;

        // Logic from C#: $"{dto.deviceName}_{dto.deviceClassroom.ToUpper()}"
        const urlSource = `${deviceName}_${deviceClassroom.toUpperCase()}`;
        const deviceURL = Buffer.from(urlSource).toString('base64');

        const device = await prisma.deviceList.create({
            data: {
                deviceName,
                deviceClassroom: deviceClassroom.toUpperCase(),
                deviceURL
            }
        });

        // 201 Created
        // Matches C# CreatedAtAction structure roughly
        res.status(201).json(device);
    }

    // PUT /api/devices/{id}
    static async updateDevice(req: Request, res: Response) {
        const id = parseInt(req.params.id);
        const { id: bodyId, ...data } = req.body;

        if (bodyId && bodyId !== id) {
            res.sendStatus(400);
            return;
        }

        try {
            // Check if we are activating a device
            if (data.deviceName && data.deviceClassroom) {
                const current = await prisma.deviceList.findUnique({ where: { id } });
                if (current && current.status === 'PENDING') {
                    // Generate URL/Secret
                    const urlSource = `${data.deviceName}_${data.deviceClassroom.toUpperCase()}`;
                    data.deviceURL = Buffer.from(urlSource).toString('base64');
                    data.status = 'ACTIVE';
                    data.deviceClassroom = data.deviceClassroom.toUpperCase(); // Ensure uppercase
                }
            }

            await prisma.deviceList.update({
                where: { id },
                data
            });
            res.sendStatus(204);
        } catch (e) {
            const exists = await prisma.deviceList.findUnique({ where: { id } });
            if (!exists) {
                res.sendStatus(404);
                return;
            }
            throw e;
        }
    }

    // DELETE /api/devices/{id}
    static async deleteDevice(req: Request, res: Response) {
        const id = parseInt(req.params.id);
        try {
            await prisma.deviceList.delete({ where: { id } });
            res.sendStatus(204);
        } catch (e) {
            // Prisma throws if not found? No, delete throws only if record doesn't exist?
            // Actually, findUnique then delete is safer to match C# logic of 404
            // But delete handles it with P2025 error if not found.
            res.sendStatus(404);
            return;
        }
    }

    // GET /api/devices/validate?room=...&secretUrl=...
    static async validateRoomAndSecretUrl(req: Request, res: Response) {
        const { room, secretUrl } = req.query;

        const device = await prisma.deviceList.findFirst({
            where: {
                deviceClassroom: String(room),
                deviceURL: String(secretUrl)
            }
        });

        if (!device) {
            return res.status(404).json({ message: "Nie znaleziono urządzenia z podanym room i secretUrl." });
        }

        return res.json({ message: "Urządzenie znalezione.", device });
    }
}
