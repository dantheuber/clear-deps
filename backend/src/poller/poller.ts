import { prisma } from '../db.js';
import { config, normalizeStatus, worstStatus } from '../config.js';

interface ProactiveDepsPayload {
  service?: string;
  dependencies?: Array<{ name: string; type?: string; status?: string; meta?: any }>; 
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
    const res = await fetch(service.endpointUrl, { signal: controller.signal, headers: { 'accept':'application/json' } });
    clearTimeout(to);
    const httpStatus = res.status;
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = await res.arrayBuffer();
    if (buf.byteLength > config.pollMaxSizeBytes) throw new Error('payload too large');
    const text = Buffer.from(buf).toString('utf8');
    const json = JSON.parse(text) as ProactiveDepsPayload;
    const deps = json.dependencies || [];
    const pollRun = await prisma.pollRun.create({ data: { serviceId: service.id, success: true, httpStatus, durationMs: Date.now()-start }});
    pollRunId = pollRun.id;
    // Insert dependencies
    const normalized = [] as any[];
    for (const d of deps) {
      const status = normalizeStatus(d.status);
      // attempt internal mapping by name+env
      const mapped = await prisma.service.findFirst({ where: { name: d.name, environment: service.environment }});
      normalized.push({ pollRunId: pollRun.id, parentServiceId: service.id, dependencyName: d.name, dependencyType: d.type || 'unknown', mappedServiceId: mapped?.id, status, metaJson: d.meta || null });
    }
    if (normalized.length) {
      await prisma.dependency.createMany({ data: normalized });
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
