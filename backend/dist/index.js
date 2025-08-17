import 'dotenv/config';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import { servicesRoutes } from './routes/services.js';
import { graphRoutes } from './routes/graph.js';
import { startScheduler } from './poller/poller.js';
const fastify = Fastify({ logger: true });
fastify.register(cors, { origin: true });
fastify.register(async (instance) => {
    await servicesRoutes(instance);
    await graphRoutes(instance);
}, { prefix: '/api/v1' });
fastify.get('/health', async () => ({ status: 'ok' }));
const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 4000;
fastify.listen({ port, host: '0.0.0.0' }).then(() => {
    startScheduler(fastify.log);
});
//# sourceMappingURL=index.js.map