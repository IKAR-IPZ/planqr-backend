import express from "express";
import { PrismaClient } from "@prisma/client";
import dotenv from "dotenv";
import cors from "cors";
import swaggerUi from "swagger-ui-express";
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



dotenv.config();

const app = express();
const port = process.env.PORT;

app.use(cors({
    origin: true, // Allow all for now, or specify frontend URL
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
        try {
            const thirtySecondsAgo = new Date(Date.now() - 30 * 1000);
            const { count } = await new PrismaClient().deviceList.deleteMany({
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
        }
    }, 10000); // Run every 10 seconds
};

startCleanupJob();



const startServer = () => {
    const disableHttps = process.env.DISABLE_HTTPS === 'true';
    const host = process.env.HOST || 'localhost';

    if (!disableHttps) {
        try {
            const certPath = path.join(__dirname, '../../certs');
            const options = {
                key: fs.readFileSync(path.join(certPath, 'cert.key')),
                cert: fs.readFileSync(path.join(certPath, 'cert.pem')),
            };

            https.createServer(options, app).listen(port, () => {
                console.log(`[Server]: Secure Server is running at https://${host}:${port}`);
                console.log(`[Server]: Swagger docs at https://${host}:${port}/api/docs`);
            });
            return;
        } catch (error) {
            console.error('[Server]: Failed to start HTTPS server, falling back to HTTP:', error);
        }
    }

    app.listen(port, () => {
        console.log(`[Server]: HTTP Server is running at http://${host}:${port}`);
        console.log(`[Server]: Swagger docs at http://${host}:${port}/api/docs`);
    });
}

startServer();