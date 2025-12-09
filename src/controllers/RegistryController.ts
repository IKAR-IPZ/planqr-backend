import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export class RegistryController {

    // POST /api/registry/handshake
    static async handshake(req: Request, res: Response) {
        const { deviceId } = req.body;

        if (!deviceId) {
            return res.status(400).json({ message: "DeviceId is required" });
        }

        let device = await prisma.deviceList.findUnique({
            where: { deviceId }
        });

        if (!device) {
            // New device, create as PENDING
            device = await prisma.deviceList.create({
                data: {
                    deviceId,
                    status: 'PENDING',
                    deviceName: null,
                    deviceClassroom: null,
                    deviceURL: null,
                    lastSeen: new Date()
                }
            });
        } else {
            // Update lastSeen for existing device
            await prisma.deviceList.update({
                where: { deviceId },
                data: { lastSeen: new Date() }
            });
        }

        // Return status
        return res.json({
            status: device.status,
            config: device.status === 'ACTIVE' ? {
                department: device.deviceClassroom, // Simplified for now, assumming room stores building too or we fix schema later
                room: device.deviceClassroom,
                secretUrl: device.deviceURL
            } : null
        });
    }

    // GET /api/registry/status/:deviceId
    static async checkStatus(req: Request, res: Response) {
        const { deviceId } = req.params;

        const device = await prisma.deviceList.findUnique({
            where: { deviceId }
        });

        if (device) {
            await prisma.deviceList.update({
                where: { deviceId },
                data: { lastSeen: new Date() }
            });
        }

        if (!device) {
            return res.status(404).json({ message: "Device not found" });
        }

        return res.json({
            status: device.status,
            config: device.status === 'ACTIVE' ? {
                // In legacy logic "room" often contained "Building/Room". 
                // We'll need to parse this in frontend or store separately.
                // For now, returning as is.
                room: device.deviceClassroom,
                secretUrl: device.deviceURL
            } : null
        });
    }
}
