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
import cookieParser from "cookie-parser";
import https from "https";
import fs from "fs";
import path from "path";


const app = express();
const port = env.PORT;
const cleanupPrisma = new PrismaClient();
let cleanupInProgress = false;

app.use(cors({
    origin: env.CORS_ORIGIN,
    credentials: true // Important for cookies!
}));
app.use(express.json());
app.use(cookieParser());

app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(specs));

app.use('/api/schedule', scheduleRoutes)
app.use('/api/auth', authRoutes);
app.use('/api/messages', messageRoutes);
app.use('/api/devices', deviceRoutes);
app.use('/api/registry', registryRoutes);
app.use('/api/Lesson', lessonRoutes);

// Start background jobs (Optional now as C# doesn't use it the same way)
// startCleanupJob();

app.get('/', (req, res) => {
    res.redirect(`/api/docs`);
}
)

// Cleanup job for stale PENDING devices
const startCleanupJob = () => {
    setInterval(async () => {
        if (cleanupInProgress) {
            return;
        }

        cleanupInProgress = true;
        try {
            const thirtySecondsAgo = new Date(Date.now() - 30 * 1000);
            const { count } = await cleanupPrisma.deviceList.deleteMany({
                where: {
                    status: 'PENDING',
                    lastSeen: {
                        lt: thirtySecondsAgo
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
    }, 10000); // Run every 10 seconds
};

startCleanupJob();



const startServer = () => {
    if (!env.DISABLE_HTTPS) {
        try {
            const certPath = path.join(__dirname, '../../certs');
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
