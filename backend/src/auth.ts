import { FastifyReply, FastifyRequest } from 'fastify';
import { config } from './config.js';

export function requireApiKey(req: FastifyRequest, reply: FastifyReply, done: () => void) {
  const key = req.headers['x-api-key'];
  if (!key || key !== config.apiKey) {
    reply.code(401).send({ error: 'unauthorized'});
    return;
  }
  done();
}
