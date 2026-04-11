import { DeviceBlackScreenMode } from './deviceDisplaySettingsService';
import { TabletNightModeSettings } from './tabletDisplaySettingsService';
import { ZutServices } from './ZutServices';

interface ScheduleApiEvent {
    start?: string;
    end?: string;
}

interface ScheduleCacheEntry {
    fetchedAt: number;
    lastLessonEndMinutes: number | null;
}

const SCHEDULE_CACHE_TTL_MS = 60 * 1000;
const roomScheduleCache = new Map<string, ScheduleCacheEntry>();
const scheduleService = new ZutServices();

const parseNightModeTimeToMinutes = (value: string) => {
    const match = value.match(/^([01]\d|2[0-3]):([0-5]\d)$/);
    if (!match) {
        return null;
    }

    return Number(match[1]) * 60 + Number(match[2]);
};

const parseClockTimeToMinutes = (value: string) => {
    const [hours, minutes] = value.split(':').map(Number);
    if (Number.isNaN(hours) || Number.isNaN(minutes)) {
        return null;
    }

    return hours * 60 + minutes;
};

const isNightModeEnabledAt = (nightMode: TabletNightModeSettings, currentDate: Date) => {
    if (!nightMode.enabled) {
        return false;
    }

    const startMinutes = parseNightModeTimeToMinutes(nightMode.startTime);
    const endMinutes = parseNightModeTimeToMinutes(nightMode.endTime);

    if (startMinutes === null || endMinutes === null || startMinutes === endMinutes) {
        return false;
    }

    const currentMinutes = currentDate.getHours() * 60 + currentDate.getMinutes();

    if (startMinutes < endMinutes) {
        return currentMinutes >= startMinutes && currentMinutes < endMinutes;
    }

    return currentMinutes >= startMinutes || currentMinutes < endMinutes;
};

const getRoomScheduleId = (room: string) => {
    const normalizedRoom = room.trim();
    if (!normalizedRoom) {
        return '';
    }

    const buildingMatch = normalizedRoom.match(/^([A-Z]+)/);
    const building = buildingMatch ? buildingMatch[1] : 'WI';

    return normalizedRoom.startsWith(building)
        ? normalizedRoom
        : `${building} ${normalizedRoom}`;
};

const buildTodayRange = (currentDate: Date) => {
    const dayBefore = new Date(currentDate);
    dayBefore.setDate(dayBefore.getDate() - 1);
    const twoDaysAfter = new Date(currentDate);
    twoDaysAfter.setDate(twoDaysAfter.getDate() + 2);

    const todayLocal = `${currentDate.getFullYear()}-${String(
        currentDate.getMonth() + 1
    ).padStart(2, '0')}-${String(currentDate.getDate()).padStart(2, '0')}`;

    return {
        todayLocal,
        start: dayBefore.toISOString().split('T')[0],
        end: twoDaysAfter.toISOString().split('T')[0]
    };
};

const getLastLessonEndMinutes = async (room: string, currentDate: Date) => {
    const { todayLocal, start, end } = buildTodayRange(currentDate);
    const roomId = getRoomScheduleId(room);

    if (!roomId) {
        return null;
    }

    const cacheKey = `${roomId}::${todayLocal}`;
    const cached = roomScheduleCache.get(cacheKey);
    if (cached && Date.now() - cached.fetchedAt <= SCHEDULE_CACHE_TTL_MS) {
        return cached.lastLessonEndMinutes;
    }

    try {
        const data = (await scheduleService.getSchedule(
            roomId,
            'room',
            start,
            end
        )) as ScheduleApiEvent[];

        const lastLessonEndMinutes = (Array.isArray(data) ? data : []).reduce<number | null>(
            (latest, event) => {
                if (!event.start || !event.end || event.start.split('T')[0] !== todayLocal) {
                    return latest;
                }

                const endMinutes = parseClockTimeToMinutes(
                    new Date(event.end).toLocaleTimeString('pl-PL', {
                        hour: '2-digit',
                        minute: '2-digit'
                    })
                );

                if (endMinutes === null) {
                    return latest;
                }

                return latest === null ? endMinutes : Math.max(latest, endMinutes);
            },
            null
        );

        roomScheduleCache.set(cacheKey, {
            fetchedAt: Date.now(),
            lastLessonEndMinutes
        });

        return lastLessonEndMinutes;
    } catch (error) {
        console.error('[TabletBlackScreen] Failed to fetch room schedule:', error);
        return cached?.lastLessonEndMinutes ?? null;
    }
};

export const getScheduledBlackScreen = async (
    room: string | null | undefined,
    nightMode: TabletNightModeSettings,
    currentDate = new Date()
) => {
    if (isNightModeEnabledAt(nightMode, currentDate)) {
        return true;
    }

    if (!nightMode.blackScreenAfterScheduleEnd || !room) {
        return false;
    }

    const lastLessonEndMinutes = await getLastLessonEndMinutes(room, currentDate);
    if (lastLessonEndMinutes === null) {
        return false;
    }

    const currentMinutes = currentDate.getHours() * 60 + currentDate.getMinutes();
    return currentMinutes >= lastLessonEndMinutes;
};

export const resolveEffectiveBlackScreen = async (options: {
    room: string | null | undefined;
    nightMode: TabletNightModeSettings;
    blackScreenMode: DeviceBlackScreenMode;
    currentDate?: Date;
}) => {
    const scheduledBlackScreen = await getScheduledBlackScreen(
        options.room,
        options.nightMode,
        options.currentDate
    );

    return {
        scheduledBlackScreen,
        effectiveBlackScreen:
            options.blackScreenMode === 'on'
                ? true
                : options.blackScreenMode === 'off'
                    ? false
                    : scheduledBlackScreen
    };
};
