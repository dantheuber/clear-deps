import { prisma } from '../db.js';
export async function graphRoutes(fastify) {
    fastify.get('/graph', async (req, reply) => {
        const { environment, includeExternal } = req.query;
        const services = await prisma.service.findMany({ where: environment ? { environment } : {}, include: { statusCurrent: true } });
        const serviceIds = services.map(s => s.id);
        const edges = await prisma.graphEdge.findMany({ where: { fromServiceId: { in: serviceIds } } });
        // Current snapshots for meta & external determination
        const currentDeps = await prisma.serviceDependencyCurrent.findMany({ where: { parentServiceId: { in: serviceIds } }, select: { parentServiceId: true, dependencyName: true, metaJson: true, mappedServiceId: true, status: true } });
        const depMetaMap = new Map();
        for (const cd of currentDeps) {
            if (cd.metaJson) {
                try {
                    depMetaMap.set(cd.parentServiceId + '::' + cd.dependencyName, JSON.parse(cd.metaJson));
                }
                catch { /* ignore */ }
            }
        }
        const nodesBase = services.map(s => ({ id: s.id, name: s.name, environment: s.environment, status: s.statusCurrent?.overallStatus || 'UNKNOWN' }));
        const includeExt = includeExternal === 'true' || includeExternal === true;
        let extNodes = [];
        if (includeExt) {
            const externalNames = Array.from(new Set(currentDeps.filter(d => !d.mappedServiceId).map(d => d.dependencyName)));
            extNodes = externalNames.map(name => ({ id: `ext:${name}`, name, environment: null, status: 'UNKNOWN', external: true }));
        }
        // Build depth (top=providers with no outgoing dependencies)
        // Stored edges: from=consumer, to=provider
        const consumers = new Set();
        const providerToConsumers = new Map();
        for (const e of edges) {
            consumers.add(e.fromServiceId);
            const prov = e.toServiceId || `ext:${e.dependencyName}`;
            if (!providerToConsumers.has(prov))
                providerToConsumers.set(prov, new Set());
            providerToConsumers.get(prov).add(e.fromServiceId);
        }
        const allNodeIds = [...nodesBase.map(n => n.id), ...extNodes.map(n => n.id)];
        const roots = allNodeIds.filter(id => !consumers.has(id));
        const depth = new Map();
        const q = [];
        for (const r of roots) {
            depth.set(r, 0);
            q.push(r);
        }
        let guard = 0;
        while (q.length && guard < allNodeIds.length * 5) {
            guard++;
            const cur = q.shift();
            const curDepth = depth.get(cur);
            const cs = providerToConsumers.get(cur);
            if (!cs)
                continue;
            for (const c of cs) {
                const nd = curDepth + 1;
                const prev = depth.get(c);
                if (prev === undefined || nd > prev) {
                    depth.set(c, nd);
                    q.push(c);
                }
            }
        }
        for (const id of allNodeIds)
            if (!depth.has(id))
                depth.set(id, 0);
        function extractLatency(meta) {
            if (!meta)
                return undefined;
            const cd = meta.checkDetails || meta;
            const candidates = ['latencyMs', 'responseTimeMs', 'durationMs', 'latency', 'timeMs'];
            for (const k of candidates) {
                if (typeof cd[k] === 'number')
                    return cd[k];
            }
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
                if (typeof h.latency === 'string') {
                    const num = Number(h.latency);
                    if (!isNaN(num))
                        return num;
                }
            }
            return undefined;
        }
        reply.send({
            nodes: [...nodesBase, ...extNodes].map(n => ({ ...n, depth: depth.get(n.id) || 0 })),
            edges: edges.map(e => {
                const meta = depMetaMap.get(e.fromServiceId + '::' + e.dependencyName);
                const latencyMs = extractLatency(meta);
                return { from: e.fromServiceId, to: e.toServiceId || `ext:${e.dependencyName}`, name: e.dependencyName, status: e.status, latencyMs };
            })
        });
    });
}
//# sourceMappingURL=graph.js.map