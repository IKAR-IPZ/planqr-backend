import axios from 'axios';

export class ZutServices {
    private readonly BASE_URL = 'https://plan.zut.edu.pl/schedule_student.php';

    async getSchedule(id: string, kind: string) {
        try {
            console.log(`Pobieram plan z ZUT dla: ${kind}=${id}`);

            const response = await axios.get(this.BASE_URL, {
                params: {
                    kind: kind,
                    id: id
                },

                headers: {
                    'User-Agent': 'Mozilla/5.0'
                }
            });

            return response.data;
        } catch (error) {
            console.error('Błąd ZUT:', error);
            throw new Error('Nie udało się pobrać danych z Plan ZUT');
        }
    }

}