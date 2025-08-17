import { FastifyInstance } from 'fastify';
import { prisma } from '../db.js';
import { z } from 'zod';
import { pollService } from '../poller/poller.js';
import { requireApiKey } from '../auth.js';

const ServiceCreate = z.object({
  name: z.string().min(1),
  environment: z.string().default('default'),
  endpointUrl: z.string().url(),
  tags: z.record(z.string()).optional(),
  owner: z.string().optional(),
  pollIntervalOverrideSec: z.number().int().positive().optional()
});

export async function servicesRoutes(fastify: FastifyInstance) {
  // Create
  fastify.post('/services', { preHandler: requireApiKey }, async (req, reply) => {
    const parsed = ServiceCreate.parse(req.body);
    // uniqueness check
    const exists = await prisma.service.findFirst({ where: { name: parsed.name, environment: parsed.environment }});
    if (exists) return reply.code(409).send({ error: 'service already exists' });
    const svc = await prisma.service.create({ data: { name: parsed.name, environment: parsed.environment, endpointUrl: parsed.endpointUrl, tagsJson: JSON.stringify(parsed.tags || {}), owner: parsed.owner, pollIntervalOverrideSec: parsed.pollIntervalOverrideSec }});
    reply.code(201).send(svc);
  });

  // List
  fastify.get('/services', async (_req, reply) => {
    const svcs = await prisma.service.findMany({ include: { statusCurrent: true }});
    reply.send(svcs.map(s=>({ id: s.id, name: s.name, environment: s.environment, endpointUrl: s.endpointUrl, overallStatus: s.statusCurrent?.overallStatus || 'UNKNOWN', updatedAt: s.updatedAt })));
  });

  // Detail
  fastify.get('/services/:id', async (req, reply) => {
    const { id } = req.params as any;
    const svc = await prisma.service.findUnique({ where: { id }, include: { statusCurrent: true }});
    if (!svc) return reply.code(404).send({ error: 'not found' });
    let tags: any = undefined;
    if (typeof svc.tagsJson === 'string') {
      try { tags = JSON.parse(svc.tagsJson); } catch { tags = {}; }
    } else if (svc.tagsJson) {
      tags = svc.tagsJson;
    }
    reply.send({
      id: svc.id,
      name: svc.name,
      environment: svc.environment,
      endpointUrl: svc.endpointUrl,
      owner: svc.owner,
      pollIntervalOverrideSec: svc.pollIntervalOverrideSec,
      createdAt: svc.createdAt,
      updatedAt: svc.updatedAt,
      overallStatus: svc.statusCurrent?.overallStatus || 'UNKNOWN',
      tags
    });
  });

  // Dependencies (latest poll)
  fastify.get('/services/:id/dependencies', async (req, reply) => {
    const { id } = req.params as any;
    const pollRun = await prisma.pollRun.findFirst({ where: { serviceId: id, success: true }, orderBy: { startedAt: 'desc' }});
    if (!pollRun) return reply.send([]);
    const deps = await prisma.dependency.findMany({ where: { pollRunId: pollRun.id }, include: { mappedService: { include: { statusCurrent: true } } }} as any);
    const transformed = deps.map(d => {
      let meta: any = undefined;
      if (typeof d.metaJson === 'string') { try { meta = JSON.parse(d.metaJson); } catch { meta = undefined; } }
      else if (d.metaJson) meta = d.metaJson;
      return {
        id: d.id,
        name: d.dependencyName,
        type: d.dependencyType,
        status: d.status,
        meta,
        mappedServiceId: d.mappedServiceId,
        mappedServiceName: (d as any).mappedService?.name,
        mappedServiceEnvironment: (d as any).mappedService?.environment,
        mappedServiceStatus: (d as any).mappedService?.statusCurrent?.overallStatus || undefined
      };
    });
    reply.send(transformed);
  });

  // On-demand refresh
  fastify.post('/services/:id/refresh', { preHandler: requireApiKey }, async (req, reply) => {
    const { id } = req.params as any;
    pollService(id, fastify.log); // fire & forget
    reply.code(202).send({ status: 'scheduled' });
  });
}
