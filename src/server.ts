import express from "express";
import { PrismaClient } from "@prisma/client";
import cors from "cors";
import swaggerUi from "swagger-ui-express";
import { env } from "./config/env";
import { specs } from "./config/swagger"
import scheduleRoutes from "./routes/scheduleRoutes";
import authRoutes from "./routes/authRoutes";
import messageRoutes from "./routes/messageRoutes";
import deviceRoutes from "./routes/deviceRoutes";
import registryRoutes from "./routes/registryRoutes";
import lessonRoutes from "./routes/lessonRoutes";
import attendanceRoutes from "./routes/attendanceRoutes";
import adminRoutes from "./routes/adminRoutes";
import statusRoutes from "./routes/statusRoutes";
import cookieParser from "cookie-parser";
import https from "https";
import fs from "fs";
import path from "path";
import { applyBasicSecurityHeaders } from "./middlewares/securityMiddleware";


const app = express();
const port = env.PORT;
const cleanupPrisma = new PrismaClient();
let cleanupInProgress = false;
const PENDING_DEVICE_STALE_AFTER_MS = 30 * 60 * 1000;
const PENDING_DEVICE_CLEANUP_INTERVAL_MS = 10 * 1000;

app.disable('x-powered-by');

app.use(cors({
    origin: env.CORS_ORIGIN,
    credentials: true // Important for cookies!
}));
app.use(applyBasicSecurityHeaders);
app.use(express.json({ limit: '32kb' }));
app.use(cookieParser());

if (env.NODE_ENV === 'development') {
    app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(specs));
}

app.use('/api/schedule', scheduleRoutes)
app.use('/api/auth', authRoutes);
app.use('/api/messages', messageRoutes);
app.use('/api/devices', deviceRoutes);
app.use('/api/admins', adminRoutes);
app.use('/api/registry', registryRoutes);
app.use('/api/Lesson', lessonRoutes);
app.use('/api/attendance', attendanceRoutes);
app.use(statusRoutes);

// Start background jobs
// startCleanupJob();

app.get('/', (req, res) => {
    if (env.NODE_ENV === 'development') {
        res.redirect(`/api/docs`);
        return;
    }

    res.status(200).json({ status: 'ok' });
}
)

// Cleanup job for stale PENDING devices
const startCleanupJob = () => {
    if (PENDING_DEVICE_STALE_AFTER_MS === null) {
        return;
    }

    setInterval(async () => {
        if (cleanupInProgress) {
            return;
        }

        cleanupInProgress = true;
        try {
            // Pending tablets should survive brief browser throttling while an admin is pairing them.
            const staleBefore = new Date(Date.now() - PENDING_DEVICE_STALE_AFTER_MS);
            const { count } = await cleanupPrisma.deviceList.deleteMany({
                where: {
                    status: 'PENDING',
                    lastSeen: {
                        lt: staleBefore
                    }
                }
            });
            if (count > 0) {
                console.log(`[Cleanup]: Removed ${count} stale pending device(s).`);
            }
        } catch (error) {
            console.error('[Cleanup]: Error removing stale devices:', error);
        } finally {
            cleanupInProgress = false;
        }
    }, PENDING_DEVICE_CLEANUP_INTERVAL_MS);
};

startCleanupJob();



const startServer = () => {
    console.log(`[Config]: NODE_ENV=${env.NODE_ENV}, DEV_AUTH_BYPASS=${env.DEV_AUTH_BYPASS}, PORT=${env.PORT}`);

    if (!env.DISABLE_HTTPS) {
        try {
            const certPath = path.join(process.cwd(), 'certs');
            const options = {
                key: fs.readFileSync(path.join(certPath, 'cert.key')),
                cert: fs.readFileSync(path.join(certPath, 'cert.pem')),
            };

            https.createServer(options, app).listen(port, () => {
                console.log(`[Server]: Secure server is running at ${env.BACKEND_PUBLIC_URL}`);
                console.log(`[Server]: Swagger docs at ${new URL('/api/docs', env.BACKEND_PUBLIC_URL).toString()}`);
            });
            return;
        } catch (error) {
            console.error('[Server]: Failed to start HTTPS server, falling back to HTTP:', error);
        }
    }

    app.listen(port, () => {
        console.log(`[Server]: HTTP server is running at ${env.BACKEND_PUBLIC_URL}`);
        console.log(`[Server]: Swagger docs at ${new URL('/api/docs', env.BACKEND_PUBLIC_URL).toString()}`);
    });
}

startServer();
