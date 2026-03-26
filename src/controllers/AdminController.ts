import { PrismaClient } from '@prisma/client';
import { Response } from 'express';
import { AuthRequest } from '../middlewares/authMiddleware';

const prisma = new PrismaClient();
const LDAP_LOGIN_PATTERN = /^[a-z0-9._-]{3,64}$/i;

const normalizeUsername = (value: string) => value.trim().toLowerCase();

const toAdminResponse = (user: {
    id: string;
    username: string;
    role: string;
    adminSource: string;
    createdAt: Date | null;
    updatedAt: Date | null;
}, currentLogin?: string) => ({
    id: user.id,
    username: user.username,
    role: user.role,
    adminSource: user.adminSource,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
    isCurrentUser: currentLogin === user.username,
    canBeRemovedFromPanel: user.adminSource === 'panel' && currentLogin !== user.username
});

export class AdminController {
    static async listAdmins(req: AuthRequest, res: Response) {
        try {
            const admins = await prisma.user.findMany({
                where: { role: { contains: 'admin', mode: 'insensitive' } },
                orderBy: [
                    { username: 'asc' }
                ]
            });

            res.json({
                admins: admins.map((admin) => toAdminResponse(admin, req.user?.login))
            });
        } catch (error) {
            console.error('Error listing admins:', error);
            res.status(500).json({ message: 'Nie udało się pobrać listy administratorów.' });
        }
    }

    static async createAdmin(req: AuthRequest, res: Response) {
        const username = typeof req.body?.username === 'string'
            ? normalizeUsername(req.body.username)
            : '';

        if (!username) {
            res.status(400).json({ message: 'Login administratora jest wymagany.' });
            return;
        }

        if (!LDAP_LOGIN_PATTERN.test(username)) {
            res.status(400).json({ message: 'Login ma nieprawidłowy format.' });
            return;
        }

        try {
            const existingUser = await prisma.user.findUnique({
                where: { username }
            });

            const admin = existingUser
                ? await prisma.user.update({
                    where: { username },
                    data: { role: 'admin' }
                })
                : await prisma.user.create({
                    data: {
                        username,
                        role: 'admin',
                        adminSource: 'panel'
                    }
                });

            const alreadyAdmin = Boolean(existingUser?.role.toLowerCase().includes('admin'));
            res.status(existingUser ? 200 : 201).json({
                message: !existingUser
                    ? 'Dodano nowego administratora z poziomu panelu.'
                    : alreadyAdmin
                        ? 'Użytkownik już miał uprawnienia administratora.'
                        : 'Nadano uprawnienia administratora istniejącemu użytkownikowi.',
                admin: toAdminResponse(admin, req.user?.login)
            });
        } catch (error) {
            console.error('Error creating admin:', error);
            res.status(500).json({ message: 'Nie udało się nadać uprawnień administratora.' });
        }
    }

    static async deleteAdmin(req: AuthRequest, res: Response) {
        const username = normalizeUsername(req.params.username ?? '');

        if (!username) {
            res.status(400).json({ message: 'Login administratora jest wymagany.' });
            return;
        }

        try {
            const admin = await prisma.user.findUnique({
                where: { username }
            });

            if (!admin || !admin.role.toLowerCase().includes('admin')) {
                res.status(404).json({ message: 'Administrator nie został znaleziony.' });
                return;
            }

            if (admin.adminSource !== 'panel') {
                res.status(409).json({ message: 'Administrator dodany z bazy danych może zostać usunięty tylko bezpośrednio w bazie danych.' });
                return;
            }

            if (req.user?.login === username) {
                res.status(409).json({ message: 'Nie możesz odebrać uprawnień samemu sobie z poziomu panelu.' });
                return;
            }

            const adminCount = await prisma.user.count({
                where: { role: { contains: 'admin', mode: 'insensitive' } }
            });

            if (adminCount <= 1) {
                res.status(409).json({ message: 'Nie można usunąć ostatniego administratora.' });
                return;
            }

            await prisma.user.update({
                where: { username },
                data: { role: 'user' }
            });

            res.status(200).json({ message: 'Uprawnienia administratora zostały odebrane.' });
        } catch (error) {
            console.error('Error deleting admin:', error);
            res.status(500).json({ message: 'Nie udało się odebrać uprawnień administratora.' });
        }
    }
}
