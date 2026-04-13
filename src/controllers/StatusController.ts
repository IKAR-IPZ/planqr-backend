import { PrismaClient } from '@prisma/client';
import { Request, Response } from 'express';
import { getDeviceConnectionStatus } from '../services/deviceStatusService';

const prisma = new PrismaClient();

interface OfflineDeviceRecord {
    room: string | null;
    lastSeen: Date;
}

export class StatusController {
    static async getStatus(_req: Request, res: Response) {
        try {
            const devices = await prisma.deviceList.findMany({
                select: {
                    deviceId: true,
                    deviceClassroom: true,
                    status: true,
                    lastSeen: true
                }
            });

            let online = 0;
            let offline = 0;
            let pending = 0;
            const offlineDevices: OfflineDeviceRecord[] = [];

            for (const device of devices) {
                const connectionStatus = getDeviceConnectionStatus(device);

                if (connectionStatus === 'ONLINE') {
                    online += 1;
                    continue;
                }

                if (connectionStatus === 'OFFLINE') {
                    offline += 1;
                    offlineDevices.push({
                        room: device.deviceClassroom,
                        lastSeen: device.lastSeen
                    });
                    continue;
                }

                pending += 1;
            }

            offlineDevices.sort((left, right) => left.lastSeen.getTime() - right.lastSeen.getTime());

            res.status(200).json({
                total: devices.length,
                online,
                offline,
                pending,
                offlineDevices: offlineDevices.map((device) => ({
                    room: device.room,
                    lastSeen: device.lastSeen.toISOString()
                }))
            });
        } catch (error) {
            console.error('Error fetching public tablet status summary:', error);
            res.status(500).json({
                message: 'Nie udało się pobrać statusu tabletów.'
            });
        }
    }
}
