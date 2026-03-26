import { Response } from 'express';
import { TabletNightModeSettings } from './tabletDisplaySettingsService';

export interface TabletDeviceConfig {
    status: string;
    room: string | null;
    secretUrl: string | null;
    nightMode: TabletNightModeSettings;
}

export interface TabletCommand {
    type: 'connected' | 'config-updated' | 'reload' | 'registry-reset';
    issuedAt: string;
    hardReload?: boolean;
    reason?: string;
    path?: string;
    config?: TabletDeviceConfig | null;
}

interface DeviceStream {
    res: Response;
    heartbeat: NodeJS.Timeout;
}

const TABLET_COMMAND_EVENT = 'tablet-command';
const deviceStreams = new Map<string, Set<DeviceStream>>();

const writeEvent = (res: Response, eventName: string, payload: unknown) => {
    res.write(`event: ${eventName}\n`);
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
};

const removeStream = (deviceId: string, stream: DeviceStream) => {
    clearInterval(stream.heartbeat);

    const streams = deviceStreams.get(deviceId);
    if (!streams) {
        return;
    }

    streams.delete(stream);
    if (streams.size === 0) {
        deviceStreams.delete(deviceId);
    }
};

export const buildTabletPath = (room: string, secretUrl: string) =>
    `/tablet/${encodeURIComponent(room)}/${encodeURIComponent(secretUrl)}`;

export const registerTabletStream = (deviceId: string, res: Response) => {
    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    const stream: DeviceStream = {
        res,
        heartbeat: setInterval(() => {
            if (!res.writableEnded && !res.destroyed) {
                res.write(': heartbeat\n\n');
            }
        }, 25000)
    };

    const streams = deviceStreams.get(deviceId) ?? new Set<DeviceStream>();
    streams.add(stream);
    deviceStreams.set(deviceId, streams);

    let cleanedUp = false;
    const cleanup = () => {
        if (cleanedUp) {
            return;
        }

        cleanedUp = true;
        removeStream(deviceId, stream);
    };

    res.on('close', cleanup);
    res.on('error', cleanup);

    writeEvent(res, TABLET_COMMAND_EVENT, {
        type: 'connected',
        issuedAt: new Date().toISOString()
    } satisfies TabletCommand);
};

export const sendTabletCommandToDevice = (deviceId: string, command: TabletCommand) => {
    const streams = deviceStreams.get(deviceId);
    if (!streams || streams.size === 0) {
        return 0;
    }

    let delivered = 0;
    for (const stream of Array.from(streams)) {
        if (stream.res.writableEnded || stream.res.destroyed) {
            removeStream(deviceId, stream);
            continue;
        }

        writeEvent(stream.res, TABLET_COMMAND_EVENT, command);
        delivered += 1;
    }

    return delivered;
};

export const broadcastTabletCommand = (command: TabletCommand) => {
    let delivered = 0;
    for (const deviceId of Array.from(deviceStreams.keys())) {
        delivered += sendTabletCommandToDevice(deviceId, command);
    }

    return delivered;
};

export const getConnectedTabletCount = () => {
    let count = 0;
    for (const streams of Array.from(deviceStreams.values())) {
        count += streams.size;
    }

    return count;
};

export const hasConnectedTabletStream = (deviceId: string) => {
    const streams = deviceStreams.get(deviceId);
    if (!streams || streams.size === 0) {
        return false;
    }

    for (const stream of Array.from(streams)) {
        if (stream.res.writableEnded || stream.res.destroyed) {
            removeStream(deviceId, stream);
            continue;
        }

        return true;
    }

    return false;
};
