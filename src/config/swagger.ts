import swaggerJsdoc from 'swagger-jsdoc';

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
                url: `https://${process.env.HOST || 'localhost'}:${process.env.PORT || 9099}`,
                description: 'Dev server',
            },
        ],
    },

    apis: ['./src/routes/*.ts', './src/server.ts'],
};

export const specs = swaggerJsdoc(options);