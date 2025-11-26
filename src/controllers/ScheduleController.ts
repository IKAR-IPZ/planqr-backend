import {Request, Response} from 'express';
import {ZutServices} from "../services/ZutServices";

export const getPlan = async(req: Request, res: Response) => {
    try {
        const service = new ZutServices()
        const {id,kind} = req.query;
        
        if (!id) {
            return res.status(400).json({ error: 'Musisz podać ID (np. numer sali)' });
        }
        
        const data = await service.getSchedule(id as string, kind as string);
        
        return res.json(data)
    }catch (error) {
        return res.status(500).json({error: 'Wystąpił błąd podczas pobierania planu $(error.message) '});
    }
}