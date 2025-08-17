const BASE = 'http://127.0.0.1:4000/api/v1';

export async function fetchJSON<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export interface ServiceSummary { id: string; name: string; environment: string; endpointUrl: string; overallStatus: string; updatedAt: string; }

export function listServices() { return fetchJSON<ServiceSummary[]>('/services'); }

export function getGraph() { return fetchJSON<{ nodes: any[]; edges: any[] }>('/graph?includeExternal=true'); }
