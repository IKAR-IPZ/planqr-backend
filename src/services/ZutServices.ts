import axios from 'axios';
import { env } from '../config/env';

export class ZutServices {
    private readonly BASE_URL = env.ZUT_SCHEDULE_STUDENT_URL;
    private readonly REQUEST_TIMEOUT_MS = 5000;

    async getSchedule(id: string, kind: string, startParam?: string, endParam?: string) {
        try {
            let startStr: string;
            let endStr: string;

            const formatZutDate = (date: Date) => {
                const y = date.getFullYear();
                const m = String(date.getMonth() + 1).padStart(2, '0');
                const d = String(date.getDate()).padStart(2, '0');
                return `${y}-${m}-${d}T00:00:00+01:00`;
            };

            const parseDate = (str: string): Date | null => {
                // URL decoding converts '+' to ' ' in timezone offset (e.g. "+01:00" → " 01:00")
                // We only need the date part anyway, so extract YYYY-MM-DD and parse that.
                const datePart = str.split('T')[0];
                const d = new Date(datePart + 'T00:00:00');
                return isNaN(d.getTime()) ? null : d;
            };

            if (startParam && endParam) {
                const start = parseDate(startParam);
                const end = parseDate(endParam);
                if (!start || !end) {
                    throw new Error(`Invalid date params: start="${startParam}", end="${endParam}"`);
                }
                startStr = formatZutDate(start);
                endStr = formatZutDate(end);
            } else {
                // Fallback: use current week
                const today = new Date();
                const dayOfWeek = today.getDay() === 0 ? 7 : today.getDay();
                const mondayDate = new Date(today);
                mondayDate.setDate(today.getDate() - (dayOfWeek - 1));
                const sundayDate = new Date(mondayDate);
                sundayDate.setDate(mondayDate.getDate() + 6);
                startStr = formatZutDate(mondayDate);
                endStr = formatZutDate(sundayDate);
            }

            console.log(`Fetching schedule for: ${kind}=${id} | Date range: ${startStr} to ${endStr}`);

            const params: any = { start: startStr, end: endStr };

            switch (kind) {
                case 'student':
                    params.number = id;
                    break;
                case 'worker':
                case 'teacher':
                    params.teacher = id;
                    break;
                case 'room':
                    params.room = id;
                    break;
                default:
                    params.room = id;
            }

            const response = await axios.get(this.BASE_URL, {
                params,
                headers: { 'User-Agent': 'Mozilla/5.0' },
                timeout: this.REQUEST_TIMEOUT_MS
            });

            return response.data;
        } catch (error) {
            console.error('ZUT error:', error);
            throw new Error(`Failed to fetch schedule data for id: ${id}`);
        }
    }
}
