import { config } from './config.js';
export function requireApiKey(req, reply, done) {
    const key = req.headers['x-api-key'];
    if (!key || key !== config.apiKey) {
        reply.code(401).send({ error: 'unauthorized' });
        return;
    }
    done();
}
//# sourceMappingURL=auth.js.map