import axios from 'axios';

export class ZutServices {
    private readonly BASE_URL = 'https://plan.zut.edu.pl/schedule_student.php';

    async getSchedule(id: string, kind: string) {
        try {
            const today = new Date();
            const dayOfWeek = today.getDay() === 0 ? 7 : today.getDay();

            const mondayDate = new Date(today);
            mondayDate.setDate(today.getDate() - (dayOfWeek - 1));

            const sundayDate = new Date(mondayDate);
            sundayDate.setDate(mondayDate.getDate() + 6);

            const formatZutDate = (date: Date) =>
                date.toISOString().split('T')[0] + 'T00:00:00+01:00';

            const startStr = formatZutDate(mondayDate);
            const endStr = formatZutDate(sundayDate);

            console.log(`Fetching schedule for: ${kind}=${id} | Week: ${startStr} to ${endStr}`);

            const params: any = {
                start: startStr,
                end: endStr
            };

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
                headers: { 'User-Agent': 'Mozilla/5.0' }
            });

            return response.data;
        } catch (error) {
            console.error('ZUT error:', error);
            throw new Error(`Failed to fetch schedule data for id: ${id}`);
        }
    }
}
