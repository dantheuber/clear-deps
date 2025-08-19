import { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { requireApiKey } from '../auth.js';
import { prisma } from '../db.js';
import { pollService } from '../poller/poller.js';

const ServiceCreate = z.object({
  name: z.string().min(1),
  environment: z.string().default('default'),
  endpointUrl: z.string().url(),
  dependencyKey: z.string().min(1).optional(),
  tags: z.record(z.string()).optional(),
  owner: z.string().optional(),
  pollIntervalOverrideSec: z.number().int().positive().optional(),
});

export async function servicesRoutes(fastify: FastifyInstance) {
  // Create
  fastify.post('/services', { preHandler: requireApiKey }, async (req, reply) => {
    const parsed = ServiceCreate.parse(req.body);
    // uniqueness check
    const exists = await prisma.service.findFirst({
      where: { name: parsed.name, environment: parsed.environment },
    });
    if (exists) return reply.code(409).send({ error: 'service already exists' });
    const svc = await prisma.service.create({
      data: {
        name: parsed.name,
        environment: parsed.environment,
        endpointUrl: parsed.endpointUrl,
        dependencyKey: parsed.dependencyKey,
        tagsJson: JSON.stringify(parsed.tags || {}),
        owner: parsed.owner,
        pollIntervalOverrideSec: parsed.pollIntervalOverrideSec,
      } as any,
    });
    reply.code(201).send(svc);
  });

  // List
  fastify.get('/services', async (_req, reply) => {
    const svcs = await prisma.service.findMany({ include: { statusCurrent: true } });
    const serviceIds = svcs.map((s) => s.id);
    // derive last poll success per service
    const lastPollMap = new Map<string, boolean>();
    try {
      const recent = await prisma.pollRun.findMany({
        where: { serviceId: { in: serviceIds } },
        orderBy: { startedAt: 'desc' },
        take: serviceIds.length * 5,
        select: { serviceId: true, success: true },
      });
      for (const pr of recent) {
        if (!lastPollMap.has(pr.serviceId)) lastPollMap.set(pr.serviceId, pr.success);
        if (lastPollMap.size === serviceIds.length) break;
      }
    } catch {
      /* ignore */
    }
    // dependency snapshot counts
    let depCounts: Array<{ parentServiceId: string; _count: { dependencyName: number } }> = [];
    try {
      depCounts = await (prisma as any).serviceDependencyCurrent.groupBy({
        by: ['parentServiceId'],
        _count: { dependencyName: true },
        where: { parentServiceId: { in: serviceIds } },
      });
    } catch {
      /* ignore unsupported groupBy prior to migration */
    }
    const depCountMap = new Map<string, number>();
    for (const dc of depCounts)
      depCountMap.set(dc.parentServiceId, (dc as any)._count.dependencyName);
    reply.send(
      svcs.map((s) => {
        const lastSuccess = lastPollMap.has(s.id) ? lastPollMap.get(s.id) : undefined;
        const reachStatus =
          lastSuccess === true ? 'OK' : lastSuccess === false ? 'ERROR' : 'UNKNOWN';
        const hasDeps = (depCountMap.get(s.id) || 0) > 0;
        return {
          id: s.id,
          name: s.name,
          environment: s.environment,
          endpointUrl: s.endpointUrl,
          dependencyKey: (s as any).dependencyKey,
          overallStatus: reachStatus,
          hasDeps,
          updatedAt: s.updatedAt,
        };
      })
    );
  });

  // Detail
  fastify.get('/services/:id', async (req, reply) => {
    const { id } = req.params as any;
    const svc = await prisma.service.findUnique({
      where: { id },
      include: { statusCurrent: true },
    });
    if (!svc) return reply.code(404).send({ error: 'not found' });
    let tags: any = undefined;
    if (typeof svc.tagsJson === 'string') {
      try {
        tags = JSON.parse(svc.tagsJson);
      } catch {
        tags = {};
      }
    } else if (svc.tagsJson) {
      tags = svc.tagsJson;
    }
    reply.send({
      id: svc.id,
      name: svc.name,
      environment: svc.environment,
      endpointUrl: svc.endpointUrl,
      dependencyKey: (svc as any).dependencyKey || undefined,
      owner: svc.owner,
      pollIntervalOverrideSec: svc.pollIntervalOverrideSec,
      createdAt: svc.createdAt,
      updatedAt: svc.updatedAt,
      overallStatus: svc.statusCurrent?.overallStatus || 'UNKNOWN',
      tags,
    });
  });

  // Dependencies (latest poll)
  fastify.get('/services/:id/dependencies', async (req, reply) => {
    const { id } = req.params as any;
    // Prefer snapshot table for faster lookups
    let rows: any[] = [];
    try {
      rows = await (prisma as any).serviceDependencyCurrent.findMany({
        where: { parentServiceId: id },
        include: { mappedService: { include: { statusCurrent: true } } },
      });
    } catch {
      // fallback to previous pollRun logic (e.g., before migration applied)
      const pollRun = await prisma.pollRun.findFirst({
        where: { serviceId: id, success: true },
        orderBy: { startedAt: 'desc' },
      });
      if (!pollRun) return reply.send([]);
      rows = await prisma.dependency.findMany({
        where: { pollRunId: pollRun.id },
        include: { mappedService: { include: { statusCurrent: true } } },
      } as any);
    }
    const transformed = rows.map((d) => {
      let meta: any = undefined;
      if (typeof d.metaJson === 'string') {
        try {
          meta = JSON.parse(d.metaJson);
        } catch {
          meta = undefined;
        }
      } else if (d.metaJson) meta = d.metaJson;
      return {
        id: d.id,
        name: d.dependencyName,
        type: d.dependencyType,
        status: d.status,
        meta,
        mappedServiceId: d.mappedServiceId,
        mappedServiceName: (d as any).mappedService?.name,
        mappedServiceEnvironment: (d as any).mappedService?.environment,
        mappedServiceStatus: (d as any).mappedService?.statusCurrent?.overallStatus || undefined,
      };
    });
    reply.send(transformed);
  });

  // Create/update a manual dependency mapping override
  fastify.post(
    '/services/:id/dependencies/map',
    { preHandler: requireApiKey },
    async (req, reply) => {
      const { id } = req.params as any;
      const body = req.body as any;
      const schema = z.object({
        dependencyName: z.string().min(1),
        mappedServiceId: z.string().uuid(),
      });
      const parsed = schema.parse(body);
      // Validate parent & mapped service exist
      const parent = await prisma.service.findUnique({ where: { id } });
      if (!parent) return reply.code(404).send({ error: 'parent service not found' });
      const mapped = await prisma.service.findUnique({ where: { id: parsed.mappedServiceId } });
      if (!mapped) return reply.code(400).send({ error: 'mapped service not found' });
      // Upsert override
      const override = await prisma.dependencyMappingOverride.upsert({
        where: {
          parentServiceId_dependencyName: {
            parentServiceId: id,
            dependencyName: parsed.dependencyName,
          },
        },
        update: { mappedServiceId: parsed.mappedServiceId },
        create: {
          parentServiceId: id,
          dependencyName: parsed.dependencyName,
          mappedServiceId: parsed.mappedServiceId,
        },
      });
      // Update current snapshot row if exists
      await (prisma as any).serviceDependencyCurrent
        .updateMany({
          where: { parentServiceId: id, dependencyName: parsed.dependencyName },
          data: { mappedServiceId: parsed.mappedServiceId, updatedAt: new Date() },
        })
        .catch(() => {});
      // Regenerate graph edges for parent service (simple approach)
      const currentRows: Array<{
        dependencyName: string;
        mappedServiceId: string | null;
        status: string;
      }> = await (prisma as any).serviceDependencyCurrent.findMany({
        where: { parentServiceId: id },
        select: { dependencyName: true, mappedServiceId: true, status: true },
      });
      await prisma.graphEdge.deleteMany({ where: { fromServiceId: id } });
      if (currentRows.length) {
        await prisma.graphEdge.createMany({
          data: currentRows.map((r) => ({
            fromServiceId: id,
            toServiceId: r.mappedServiceId,
            dependencyName: r.dependencyName,
            status: r.status,
          })),
        });
      }
      reply.code(201).send(override);
    }
  );

  // Delete a manual mapping override
  fastify.delete(
    '/services/:id/dependencies/map/:dependencyName',
    { preHandler: requireApiKey },
    async (req, reply) => {
      const { id, dependencyName } = req.params as any;
      await prisma.dependencyMappingOverride
        .delete({
          where: { parentServiceId_dependencyName: { parentServiceId: id, dependencyName } },
        })
        .catch(() => {});
      // Re-evaluate mapping for snapshot row (try automatic name match)
      const snap = await (prisma as any).serviceDependencyCurrent
        .findUnique({
          where: { parentServiceId_dependencyName: { parentServiceId: id, dependencyName } },
        })
        .catch(() => null);
      if (snap) {
        const parent = await prisma.service.findUnique({ where: { id } });
        let mapped: any = null;
        if (parent) {
          mapped = await prisma.service.findFirst({
            where: { name: dependencyName, environment: parent.environment },
          });
        }
        await (prisma as any).serviceDependencyCurrent
          .update({
            where: { parentServiceId_dependencyName: { parentServiceId: id, dependencyName } },
            data: { mappedServiceId: mapped?.id || null, updatedAt: new Date() },
          })
          .catch(() => {});
        // Rebuild edges for parent
        const rows: Array<{
          dependencyName: string;
          mappedServiceId: string | null;
          status: string;
        }> = await (prisma as any).serviceDependencyCurrent.findMany({
          where: { parentServiceId: id },
          select: { dependencyName: true, mappedServiceId: true, status: true },
        });
        await prisma.graphEdge.deleteMany({ where: { fromServiceId: id } });
        if (rows.length)
          await prisma.graphEdge.createMany({
            data: rows.map((r) => ({
              fromServiceId: id,
              toServiceId: r.mappedServiceId,
              dependencyName: r.dependencyName,
              status: r.status,
            })),
          });
      }
      reply.code(204).send();
    }
  );

  // Delete service (and associated data)
  fastify.delete('/services/:id', { preHandler: requireApiKey }, async (req, reply) => {
    const { id } = req.params as any;
    const svc = await prisma.service.findUnique({ where: { id }, select: { id: true } });
    if (!svc) return reply.code(404).send({ error: 'not found' });
    // Gather poll run ids first
    const pollRuns = await prisma.pollRun.findMany({
      where: { serviceId: id },
      select: { id: true },
    });
    const pollRunIds = pollRuns.map((pr) => pr.id);
    await prisma.$transaction(async (tx) => {
      // Null out mappings pointing to this service (excluding its own dependencies which will be deleted via pollRuns)
      await tx.dependency.updateMany({
        where: { mappedServiceId: id, NOT: { parentServiceId: id } },
        data: { mappedServiceId: null },
      });
      // Overrides
      await tx.dependencyMappingOverride.deleteMany({
        where: { OR: [{ parentServiceId: id }, { mappedServiceId: id }] },
      });
      // Current dependency snapshots
      await tx.serviceDependencyCurrent.deleteMany({
        where: { OR: [{ parentServiceId: id }, { mappedServiceId: id }] },
      });
      // History
      await tx.dependencyHistory.deleteMany({ where: { serviceId: id } });
      // Graph edges
      await tx.graphEdge.deleteMany({
        where: { OR: [{ fromServiceId: id }, { toServiceId: id }] },
      });
      // Dependencies produced by this service's poll runs
      if (pollRunIds.length) {
        await tx.dependency.deleteMany({ where: { pollRunId: { in: pollRunIds } } });
      }
      // Poll runs
      await tx.pollRun.deleteMany({ where: { serviceId: id } });
      // Current status
      await tx.serviceStatusCurrent.deleteMany({ where: { serviceId: id } });
      // Finally service
      await tx.service.delete({ where: { id } });
    });
    reply.code(204).send();
  });

  // List overrides for a service
  fastify.get('/services/:id/dependencies/overrides', async (req, reply) => {
    const { id } = req.params as any;
    const rows = await prisma.dependencyMappingOverride.findMany({
      where: { parentServiceId: id },
      include: { mappedService: { select: { id: true, name: true, environment: true } } },
    } as any);
    reply.send(
      rows.map((r) => ({
        dependencyName: r.dependencyName,
        mappedServiceId: r.mappedServiceId,
        mappedServiceName: (r as any).mappedService.name,
        mappedServiceEnvironment: (r as any).mappedService.environment,
      }))
    );
  });

  // On-demand refresh
  fastify.post('/services/:id/refresh', { preHandler: requireApiKey }, async (req, reply) => {
    const { id } = req.params as any;
    pollService(id, fastify.log); // fire & forget
    reply.code(202).send({ status: 'scheduled' });
  });
}
