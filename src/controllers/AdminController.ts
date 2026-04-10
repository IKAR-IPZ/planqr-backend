import { randomUUID } from 'crypto';
import { PrismaClient } from '@prisma/client';
import { Response } from 'express';
import { AuthRequest } from '../middlewares/authMiddleware';

const prisma = new PrismaClient();
const LDAP_LOGIN_PATTERN = /^[a-z0-9._-]{3,64}$/i;

interface AdminRecord {
    id: string;
    username: string;
    adminSource: string;
    createdAt: Date;
    updatedAt: Date;
}

const normalizeUsername = (value: string) => value.trim().toLowerCase();

const toAdminResponse = (admin: AdminRecord, currentLogin?: string) => ({
    id: admin.id,
    username: admin.username,
    adminSource: admin.adminSource,
    createdAt: admin.createdAt,
    updatedAt: admin.updatedAt,
    isCurrentUser: currentLogin === admin.username,
    canBeRemovedFromPanel: admin.adminSource === 'panel' && currentLogin !== admin.username
});

export class AdminController {
    static async listAdmins(req: AuthRequest, res: Response) {
        try {
            const admins = await prisma.$queryRaw<AdminRecord[]>`
                SELECT "id", "username", "adminSource", "createdAt", "updatedAt"
                FROM "admins"
                ORDER BY "username" ASC
            `;

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
            const [existingAdmin] = await prisma.$queryRaw<AdminRecord[]>`
                SELECT "id", "username", "adminSource", "createdAt", "updatedAt"
                FROM "admins"
                WHERE "username" = ${username}
                LIMIT 1
            `;

            if (existingAdmin) {
                res.status(200).json({
                    message: 'To konto jest już administratorem.',
                    admin: toAdminResponse(existingAdmin, req.user?.login)
                });
                return;
            }

            const [admin] = await prisma.$queryRaw<AdminRecord[]>`
                INSERT INTO "admins" ("id", "username", "adminSource", "createdAt", "updatedAt")
                VALUES (${randomUUID()}, ${username}, 'panel', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                RETURNING "id", "username", "adminSource", "createdAt", "updatedAt"
            `;

            res.status(201).json({
                message: 'Dodano administratora.',
                admin: toAdminResponse(admin, req.user?.login)
            });
        } catch (error) {
            console.error('Error creating admin:', error);
            res.status(500).json({ message: 'Nie udało się dodać administratora.' });
        }
    }

    static async deleteAdmin(req: AuthRequest, res: Response) {
        const username = normalizeUsername(req.params.username ?? '');

        if (!username) {
            res.status(400).json({ message: 'Login administratora jest wymagany.' });
            return;
        }

        try {
            const [admin] = await prisma.$queryRaw<AdminRecord[]>`
                SELECT "id", "username", "adminSource", "createdAt", "updatedAt"
                FROM "admins"
                WHERE "username" = ${username}
                LIMIT 1
            `;

            if (!admin) {
                res.status(404).json({ message: 'Administrator nie został znaleziony.' });
                return;
            }

            if (admin.adminSource !== 'panel') {
                res.status(409).json({ message: 'Administrator dodany z bazy danych może zostać usunięty tylko bezpośrednio w bazie danych.' });
                return;
            }

            if (req.user?.login === username) {
                res.status(409).json({ message: 'Nie możesz usunąć własnego konta administratora z poziomu panelu.' });
                return;
            }

            const [adminCountRow] = await prisma.$queryRaw<Array<{ count: number }>>`
                SELECT CAST(COUNT(*) AS INTEGER) AS "count"
                FROM "admins"
            `;
            const adminCount = adminCountRow?.count ?? 0;

            if (adminCount <= 1) {
                res.status(409).json({ message: 'Nie można usunąć ostatniego administratora.' });
                return;
            }

            await prisma.$executeRaw`
                DELETE FROM "admins"
                WHERE "username" = ${username}
            `;

            res.status(200).json({ message: 'Administrator został usunięty z listy.' });
        } catch (error) {
            console.error('Error deleting admin:', error);
            res.status(500).json({ message: 'Nie udało się usunąć administratora.' });
        }
    }
}
