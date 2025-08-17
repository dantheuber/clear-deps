import { FastifyInstance } from 'fastify';
import { prisma } from '../db.js';

export async function graphRoutes(fastify: FastifyInstance) {
  fastify.get('/graph', async (req, reply) => {
    const { environment, includeExternal } = req.query as any;
    const services = await prisma.service.findMany({ where: environment ? { environment } : {}, include: { statusCurrent: true }});
    const edges = await prisma.graphEdge.findMany({ where: { fromServiceId: { in: services.map(s=>s.id) }}});
    const nodes = services.map(s=>({ id: s.id, name: s.name, environment: s.environment, status: s.statusCurrent?.overallStatus || 'UNKNOWN' }));
    const includeExt = includeExternal === 'true' || includeExternal === true;
    let extNodes: any[] = [];
    if (includeExt) {
      // derive external dependencies (dependencies w/out mapped service)
      const depRows = await prisma.dependency.findMany({ where: { parentServiceId: { in: services.map(s=>s.id) } }, select: { dependencyName: true, mappedServiceId: true }});
      const externalNames = Array.from(new Set(depRows.filter(d=>!d.mappedServiceId).map(d=>d.dependencyName)));
      extNodes = externalNames.map(name=>({ id: `ext:${name}`, name, environment: null, status: 'UNKNOWN', external: true }));
    }
    reply.send({ nodes: [...nodes, ...extNodes], edges: edges.map(e=>({ from: e.fromServiceId, to: e.toServiceId || `ext:${e.dependencyName}`, name: e.dependencyName, status: e.status })) });
  });
}
