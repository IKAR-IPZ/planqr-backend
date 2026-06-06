import { PrismaClient } from '@prisma/client';
import { synchronizePriorityMessageAssignments } from '../services/tabletPriorityMessageService';
import { sendTabletCommandToDevice } from '../services/tabletStreamService';

const prisma = new PrismaClient();
const SYNC_INTERVAL_MS = 5000;
let synchronizationInProgress = false;

const synchronizeSchedules = async () => {
    if (synchronizationInProgress) {
        return;
    }

    synchronizationInProgress = true;
    try {
        const { changedDeviceIds } = await synchronizePriorityMessageAssignments(prisma);
        if (changedDeviceIds.length === 0) {
            return;
        }

        const devices = await prisma.deviceList.findMany({
            where: {
                id: {
                    in: changedDeviceIds
                }
            }
        });
        let delivered = 0;
        for (const device of devices) {
            delivered += sendTabletCommandToDevice(device.deviceId, {
                type: 'reload',
                issuedAt: new Date().toISOString(),
                hardReload: true,
                reason: 'priority-message-schedule-boundary'
            });
        }

        console.info(
            `[PriorityMessageSchedule] Synchronized ${changedDeviceIds.length} device(s), delivered=${delivered}.`
        );
    } catch (error) {
        console.error('[PriorityMessageSchedule] Synchronization failed:', error);
    } finally {
        synchronizationInProgress = false;
    }
};

export const startPriorityMessageScheduleJob = () => {
    void synchronizeSchedules();
    setInterval(() => {
        void synchronizeSchedules();
    }, SYNC_INTERVAL_MS);
};
