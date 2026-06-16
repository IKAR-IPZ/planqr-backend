import { randomUUID } from 'crypto';
import { PrismaClient } from '@prisma/client';
import { Response } from 'express';
import { AuthRequest } from '../middlewares/authMiddleware';
import { getRootAdminLogin, isRootAdminLogin } from '../services/rootAdminService';

const prisma = new PrismaClient();
const LDAP_LOGIN_PATTERN = /^[a-z0-9._-]{3,64}$/i;

interface AdminRecord {
    id: string;
    username: string;
    adminSource: string;
    createdAt: Date | null;
    updatedAt: Date | null;
}

const normalizeUsername = (value: string) => value.trim().toLowerCase();

const toAdminResponse = (admin: AdminRecord, currentLogin?: string) => {
    const normalizedCurrentLogin = currentLogin ? normalizeUsername(currentLogin) : undefined;

    return {
        id: admin.id,
        username: admin.username,
        adminSource: admin.adminSource,
        createdAt: admin.createdAt,
        updatedAt: admin.updatedAt,
        isCurrentUser: normalizedCurrentLogin === admin.username,
        canBeRemovedFromPanel: !isRootAdminLogin(admin.username) && normalizedCurrentLogin !== admin.username
    };
};

const buildRootAdminRecord = (): AdminRecord | null => {
    const rootAdminLogin = getRootAdminLogin();
    if (!rootAdminLogin) {
        return null;
    }

    return {
        id: `env:${rootAdminLogin}`,
        username: rootAdminLogin,
        adminSource: 'env',
        createdAt: null,
        updatedAt: null,
    };
};

export class AdminController {
    static async listAdmins(req: AuthRequest, res: Response) {
        try {
            const admins = await prisma.$queryRaw<AdminRecord[]>`
                SELECT "id", "username", "adminSource", "createdAt", "updatedAt"
                FROM "admins"
                ORDER BY "username" ASC
            `;
            const rootAdmin = buildRootAdminRecord();
            const mergedAdmins = rootAdmin && !admins.some((admin) => isRootAdminLogin(admin.username))
                ? [rootAdmin, ...admins]
                : admins.map((admin) => isRootAdminLogin(admin.username) ? { ...admin, adminSource: 'env' } : admin);

            res.json({
                admins: mergedAdmins.map((admin) => toAdminResponse(admin, req.user?.login))
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

        if (isRootAdminLogin(username)) {
            const rootAdmin = buildRootAdminRecord();
            res.status(200).json({
                message: 'To konto jest już administratorem.',
                admin: rootAdmin ? toAdminResponse(rootAdmin, req.user?.login) : null
            });
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

        if (isRootAdminLogin(username)) {
            res.status(409).json({ message: 'Konto administratora z konfiguracji środowiska nie może zostać usunięte z panelu.' });
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

            if (req.user?.login && normalizeUsername(req.user.login) === username) {
                res.status(409).json({ message: 'Nie możesz usunąć własnego konta administratora z poziomu panelu.' });
                return;
            }

            const [adminCountRow] = await prisma.$queryRaw<Array<{ count: number }>>`
                SELECT CAST(COUNT(*) AS INTEGER) AS "count"
                FROM "admins"
            `;
            const adminCount = adminCountRow?.count ?? 0;
            const totalAdminCount = adminCount + (getRootAdminLogin() ? 1 : 0);

            if (totalAdminCount <= 1) {
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
