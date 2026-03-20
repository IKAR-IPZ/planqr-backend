import swaggerJsdoc from 'swagger-jsdoc';
import { env } from './env';

const options = {
    definition: {
        openapi: '3.0.0',
        info: {
            title: 'PlanQR API',
            version: '1.0.0',
            description: 'API docs for PlanQR project',
        },
        servers: [
            {
                url: env.BACKEND_PUBLIC_URL,
                description: `${env.NODE_ENV} server`,
            },
        ],
    },

    apis: ['./src/routes/*.ts', './src/server.ts'],
};

export const specs = swaggerJsdoc(options);
