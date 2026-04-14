import {Request, Response} from 'express';
import {ZutServices} from "../services/ZutServices";
import crypto from 'crypto';

const MAX_SCHEDULE_ID_LENGTH = 120;
const ALLOWED_SCHEDULE_KINDS = new Set(['room', 'worker', 'teacher', 'student']);

// Generate a stable numeric ID from event properties (start + room + teacher)
function generateLessonId(event: any): number {
    const key = `${event.start || ''}|${event.room || ''}|${event.worker_title || ''}`;
    const hash = crypto.createHash('md5').update(key).digest('hex');
    // Take first 8 hex chars, parse, and cap to PostgreSQL INT4 max (2,147,483,647)
    return parseInt(hash.substring(0, 8), 16) % 2147483647;
}

export const getPlan = async(req: Request, res: Response) => {
    try {
        const service = new ZutServices()
        const { id, kind, start, end } = req.query;
        
        if (!id) {
            return res.status(400).json({ error: 'Musisz podać ID (np. numer sali)' });
        }

        const normalizedId = String(id).trim();
        const normalizedKind = String(kind ?? 'room').toLowerCase();

        if (!normalizedId || normalizedId.length > MAX_SCHEDULE_ID_LENGTH) {
            return res.status(400).json({ error: 'Nieprawidłowe ID planu.' });
        }

        if (!ALLOWED_SCHEDULE_KINDS.has(normalizedKind)) {
            return res.status(400).json({ error: 'Nieprawidłowy rodzaj planu.' });
        }
        
        const data = await service.getSchedule(normalizedId, normalizedKind, start as string, end as string);

        // Enrich each event with a stable numeric ID if it doesn't have one
        const enriched = Array.isArray(data)
            ? data.map((event: any) => ({
                ...event,
                id: event.id ?? generateLessonId(event),
            }))
            : data;
        
        return res.json(enriched);
    } catch (error) {
        return res.status(500).json({error: 'Wystąpił błąd podczas pobierania planu'});
    }
}
