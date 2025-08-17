import { prisma } from '../db.js';
import { config, normalizeStatus, worstStatus, statusFromHealthyFlag } from '../config.js';

interface ProactiveDepsPayload {
  service?: string;
  dependencies?: Array<{ name: string; type?: string; status?: string; meta?: any }>; 
}

// Lightweight debug logger (enabled via DEBUG_POLLER env var)
function fastDebug(logger: any, event: string, data: Record<string, any>) {
  if (process.env.DEBUG_POLLER) {
    logger.info({ evt: event, ...data });
  }
}

let running = false;

export async function pollDueServices(logger: any) {
  if (running) return; // simple reentrancy guard
  running = true;
  try {
    const now = new Date();
    // naive selection: services whose lastPolledAt older than interval
    const services = await prisma.service.findMany();
    const due = services.filter((s: any) => {
      const interval = s.pollIntervalOverrideSec ?? config.defaultPollIntervalSec;
      if (!s.lastPolledAt) return true;
      return (now.getTime() - s.lastPolledAt.getTime()) / 1000 >= interval;
    });
    const slice = due.slice(0, config.maxParallelPolls);
  await Promise.all(slice.map((s: any) => pollService(s.id, logger)));
  } catch (e) {
    logger.error(e, 'poll cycle error');
  } finally {
    running = false;
  }
}

export async function pollService(serviceId: string, logger: any) {
  const service = await prisma.service.findUnique({ where: { id: serviceId }});
  if (!service) return;
  const start = Date.now();
  let pollRunId: string | undefined;
  try {
    const controller = new AbortController();
    const to = setTimeout(()=>controller.abort(), config.pollTimeoutMs);
    const fetchStart = Date.now();
    fastDebug(logger, 'poll.fetch.begin', { serviceId: service.id, url: service.endpointUrl });
    const res = await fetch(service.endpointUrl, { signal: controller.signal, headers: { 'accept':'application/json' } });
    clearTimeout(to);
    const httpStatus = res.status;
    const fetchDurationMs = Date.now() - fetchStart;
    if (!res.ok) {
      fastDebug(logger, 'poll.fetch.non_ok', { serviceId: service.id, httpStatus });
      throw new Error(`HTTP ${res.status}`);
    }
    const buf = await res.arrayBuffer();
    const byteLength = buf.byteLength;
    if (buf.byteLength > config.pollMaxSizeBytes) throw new Error('payload too large');
    const text = Buffer.from(buf).toString('utf8');
    let json: any;
    try {
      json = JSON.parse(text);
    } catch (e: any) {
      logger.warn({ serviceId: service.id, err: e.message, snippet: text.slice(0,300) }, 'poll json parse error');
      throw new Error('invalid json');
    }
    // Determine dependency list shape
    let deps: Array<{ name: string; type?: string; status?: string; meta?: any }> = [];
    let parseMode = 'object.dependencies';
    if (Array.isArray(json)) {
      deps = json as any;
      parseMode = 'array_root';
    } else if (Array.isArray(json.dependencies)) {
      deps = json.dependencies as any;
    } else if (Array.isArray((json as any).deps)) { // alternate key fallback
      deps = (json as any).deps as any;
      parseMode = 'object.deps';
    } else {
      parseMode = 'no_deps_found';
    }
    fastDebug(logger, 'poll.payload.parsed', { serviceId: service.id, httpStatus, bytes: byteLength, fetchMs: fetchDurationMs, parseMode, depsCount: deps.length });
    const pollRun = await prisma.pollRun.create({ data: { serviceId: service.id, success: true, httpStatus, durationMs: Date.now()-start }});
    pollRunId = pollRun.id;
    // Insert dependencies
    const normalized = [] as any[];
    for (const d of deps) {
      if (!d || typeof d !== 'object') continue;
      const rawHealthy = (d as any).healthy;
      let status = statusFromHealthyFlag(rawHealthy);
      if (!status) {
        status = normalizeStatus((d as any).status);
      }
      const name = (d as any).name || (d as any).service || (d as any).id;
      if (!name) continue;
      // Determine type precedence: explicit d.type, then nested checkDetails.type, else 'unknown'
      let depType: string | undefined = (d as any).type;
      const checkDetails = (d as any).checkDetails;
      if (!depType && checkDetails && typeof checkDetails === 'object' && typeof checkDetails.type === 'string') {
        depType = checkDetails.type;
      }
      // Check manual override first
      const override = await prisma.dependencyMappingOverride.findUnique({ where: { parentServiceId_dependencyName: { parentServiceId: service.id, dependencyName: name } }}).catch(()=>null);
      let mapped = undefined as any;
      if (override) {
        mapped = await prisma.service.findUnique({ where: { id: override.mappedServiceId }});
      } else {
        // attempt internal mapping by exact name+env
        mapped = await prisma.service.findFirst({ where: { name: name, environment: service.environment }});
      }
      let metaStr: string | null = null;
      if ((d as any).meta !== undefined) {
        try { metaStr = JSON.stringify((d as any).meta); } catch { metaStr = null; }
      }
      // If we have checkDetails and no meta, include it inside meta for visibility
      if (!metaStr && checkDetails) {
        try { metaStr = JSON.stringify({ checkDetails }); } catch { /* ignore */ }
      } else if (metaStr && checkDetails) {
        // merge existing meta with checkDetails if meta was object
        try {
          const existing = JSON.parse(metaStr);
          const merged = { ...existing, checkDetails };
          metaStr = JSON.stringify(merged);
        } catch { /* ignore */ }
      }
      // Merge in health object if present (so graph can read health.latency)
      const health = (d as any).health;
      if (health && typeof health === 'object') {
        if (!metaStr) {
          try { metaStr = JSON.stringify({ health }); } catch { /* ignore */ }
        } else {
          try {
            const existing = JSON.parse(metaStr);
            if (!existing.health || typeof existing.health !== 'object') {
              existing.health = health;
            } else {
              existing.health = { ...existing.health, ...health };
            }
            metaStr = JSON.stringify(existing);
          } catch { /* ignore */ }
        }
      }
  normalized.push({ pollRunId: pollRun.id, parentServiceId: service.id, dependencyName: name, dependencyType: depType || 'unknown', mappedServiceId: mapped?.id, status, metaJson: metaStr });
    }
    if (normalized.length === 0 && deps.length > 0) {
      fastDebug(logger, 'poll.deps.filtered_all_out', { serviceId: service.id, rawDepsCount: deps.length });
    }
    if (normalized.length) {
      await prisma.dependency.createMany({ data: normalized });
    }
    // Maintain current dependencies snapshot table
    // Strategy: upsert each normalized row, then remove stale rows no longer present
    if (normalized.length) {
      const names = normalized.map(n=>n.dependencyName);
      for (const n of normalized) {
        await prisma.serviceDependencyCurrent.upsert({
          where: { parentServiceId_dependencyName: { parentServiceId: service.id, dependencyName: n.dependencyName } },
          update: { dependencyType: n.dependencyType, mappedServiceId: n.mappedServiceId, status: n.status, metaJson: n.metaJson || undefined },
          create: { parentServiceId: service.id, dependencyName: n.dependencyName, dependencyType: n.dependencyType, mappedServiceId: n.mappedServiceId, status: n.status, metaJson: n.metaJson || undefined }
        });
      }
      // delete stale current deps that were not reported this time
      await prisma.serviceDependencyCurrent.deleteMany({ where: { parentServiceId: service.id, dependencyName: { notIn: names } }});
    } else {
      // If no dependencies returned at all, clear existing snapshot for this service
      await prisma.serviceDependencyCurrent.deleteMany({ where: { parentServiceId: service.id }});
    }
    // Recompute overall status
    const status = normalized.length ? worstStatus(normalized.map(d=>d.status)) : 'UNKNOWN';
    await prisma.serviceStatusCurrent.upsert({
      where: { serviceId: service.id },
      update: { overallStatus: status, updatedAt: new Date() },
      create: { serviceId: service.id, overallStatus: status }
    });
    // Graph edges: clear and rebuild for this service (MVP simple)
    await prisma.graphEdge.deleteMany({ where: { fromServiceId: service.id }});
    if (normalized.length) {
      await prisma.graphEdge.createMany({ data: normalized.map(n=>({ fromServiceId: service.id, toServiceId: n.mappedServiceId, dependencyName: n.dependencyName, status: n.status })) });
    }
    // History rows (last 24h focus; we still store always, retention mgmt TBD)
    if (normalized.length) {
      await prisma.dependencyHistory.createMany({ data: normalized.map(n=>({ serviceId: service.id, dependencyName: n.dependencyName, status: n.status })) });
    }
    await prisma.service.update({ where: { id: service.id }, data: { lastPolledAt: new Date(), consecutiveFailures: 0 }});
    logger.info({ serviceId: service.id, deps: normalized.length }, 'poll success');
  } catch (err: any) {
    logger.warn({ err: err.message, serviceId: service.id }, 'poll failure');
    const pollRun = await prisma.pollRun.create({ data: { serviceId: service.id, success: false, httpStatus: undefined, durationMs: Date.now()-start, errorMessage: err.message }});
    pollRunId = pollRun.id;
    await prisma.service.update({ where: { id: service.id }, data: { lastPolledAt: new Date(), consecutiveFailures: { increment: 1 } }});
    // escalate status if failures exceed threshold (simple rule: 3)
    const svc = await prisma.service.findUnique({ where: { id: service.id }, select: { consecutiveFailures: true }});
    if (svc && svc.consecutiveFailures >= 3) {
      await prisma.serviceStatusCurrent.upsert({
        where: { serviceId: service.id },
        update: { overallStatus: 'ERROR', updatedAt: new Date() },
        create: { serviceId: service.id, overallStatus: 'ERROR' }
      });
    }
  }
  return pollRunId;
}

export function startScheduler(logger: any) {
  setInterval(()=> pollDueServices(logger), 1000); // tick every second; we decide due set
  logger.info('poller scheduler started');
}
