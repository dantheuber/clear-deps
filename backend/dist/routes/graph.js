import { prisma } from '../db.js';
export async function graphRoutes(fastify) {
    fastify.get('/graph', async (req, reply) => {
        const { environment, includeExternal } = req.query;
        const services = await prisma.service.findMany({ where: environment ? { environment } : {}, include: { statusCurrent: true } });
        const edges = await prisma.graphEdge.findMany({ where: { fromServiceId: { in: services.map(s => s.id) } } });
        // Load current dependency snapshots for latency/meta extraction
        const currentDeps = await prisma.serviceDependencyCurrent.findMany({ where: { parentServiceId: { in: services.map(s => s.id) } }, select: { parentServiceId: true, dependencyName: true, metaJson: true } });
        const depMetaMap = new Map();
        for (const cd of currentDeps) {
            if (cd.metaJson) {
                try {
                    depMetaMap.set(cd.parentServiceId + '::' + cd.dependencyName, JSON.parse(cd.metaJson));
                }
                catch { /* ignore */ }
            }
        }
        const nodes = services.map(s => ({ id: s.id, name: s.name, environment: s.environment, status: s.statusCurrent?.overallStatus || 'UNKNOWN' }));
        const includeExt = includeExternal === 'true' || includeExternal === true;
        let extNodes = [];
        if (includeExt) {
            // derive external dependencies (dependencies w/out mapped service)
            const depRows = await prisma.dependency.findMany({ where: { parentServiceId: { in: services.map(s => s.id) } }, select: { dependencyName: true, mappedServiceId: true } });
            const externalNames = Array.from(new Set(depRows.filter(d => !d.mappedServiceId).map(d => d.dependencyName)));
            extNodes = externalNames.map(name => ({ id: `ext:${name}`, name, environment: null, status: 'UNKNOWN', external: true }));
        }
        function extractLatency(meta) {
            if (!meta)
                return undefined;
            const cd = meta.checkDetails || meta;
            const candidates = ['latencyMs', 'responseTimeMs', 'durationMs', 'latency', 'timeMs'];
            for (const k of candidates) {
                if (typeof cd[k] === 'number')
                    return cd[k];
            }
            // look into health objects (meta.health or meta.checkDetails.health)
            const healthObjs = [];
            if (meta.health && typeof meta.health === 'object')
                healthObjs.push(meta.health);
            if (cd.health && typeof cd.health === 'object')
                healthObjs.push(cd.health);
            for (const h of healthObjs) {
                if (typeof h.latency === 'number')
                    return h.latency;
                if (typeof h.latencyMs === 'number')
                    return h.latencyMs;
                // Sometimes latency might be a numeric string
                if (typeof h.latency === 'string') {
                    const num = Number(h.latency);
                    if (!isNaN(num))
                        return num;
                }
            }
            return undefined;
        }
        reply.send({ nodes: [...nodes, ...extNodes], edges: edges.map(e => {
                const meta = depMetaMap.get(e.fromServiceId + '::' + e.dependencyName);
                const latencyMs = extractLatency(meta);
                return { from: e.fromServiceId, to: e.toServiceId || `ext:${e.dependencyName}`, name: e.dependencyName, status: e.status, latencyMs };
            }) });
    });
}
//# sourceMappingURL=graph.js.map