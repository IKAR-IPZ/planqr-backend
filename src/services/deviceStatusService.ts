import { hasConnectedTabletStream } from './tabletStreamService';

export const TABLET_OFFLINE_THRESHOLD_MS = 75 * 1000;

export type DeviceConnectionStatus = 'PENDING' | 'ONLINE' | 'OFFLINE';

interface DeviceStatusSource {
    deviceId: string;
    status: string;
    lastSeen: Date;
}

export const getDeviceConnectionStatus = (
    device: DeviceStatusSource
): DeviceConnectionStatus => {
    if (device.status !== 'ACTIVE') {
        return 'PENDING';
    }

    if (hasConnectedTabletStream(device.deviceId)) {
        return 'ONLINE';
    }

    const heartbeatAgeMs = Date.now() - device.lastSeen.getTime();
    return heartbeatAgeMs <= TABLET_OFFLINE_THRESHOLD_MS ? 'ONLINE' : 'OFFLINE';
};
