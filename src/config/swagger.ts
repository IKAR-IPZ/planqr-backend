import swaggerJsdoc from 'swagger-jsdoc';

const options = {
    definition: {
        openapi: '3.0.0',
        info: {
            title: 'PlanQR API',
            version: '1.0.0',
            description: 'Dokumentacja API do projektu PlanQR',
        },
        servers: [
            {
                url: 'http://localhost:9099',
                description: 'Serwer deweloperski',
            },
        ],
    },

    apis: ['./src/routes/*.ts', './src/server.ts'],
};

export const specs = swaggerJsdoc(options);