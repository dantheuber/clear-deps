const BASE = 'http://127.0.0.1:4000/api/v1';

export async function fetchJSON<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export interface ServiceSummary { id: string; name: string; environment: string; endpointUrl: string; overallStatus: string; updatedAt: string; }

export function listServices() { return fetchJSON<ServiceSummary[]>('/services'); }

export function getGraph() { return fetchJSON<{ nodes: any[]; edges: any[] }>('/graph?includeExternal=true'); }

export interface CreateServiceInput {
  name: string;
  endpointUrl: string;
  environment?: string;
  pollIntervalOverrideSec?: number;
}

export async function createService(input: CreateServiceInput, apiKey: string): Promise<ServiceSummary> {
  const res = await fetch(`${BASE}/services`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
    },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export interface ServiceDetail extends ServiceSummary {
  owner?: string;
  pollIntervalOverrideSec?: number;
  createdAt: string;
  tags?: Record<string, string>;
}

export interface DependencyItem {
  id: string;
  name: string;
  type?: string;
  status: string;
  meta?: any;
  mappedServiceId?: string;
  mappedServiceName?: string;
  mappedServiceEnvironment?: string;
  mappedServiceStatus?: string;
}

export function getService(id: string) { return fetchJSON<ServiceDetail>(`/services/${id}`); }
export function getServiceDependencies(id: string) { return fetchJSON<DependencyItem[]>(`/services/${id}/dependencies`); }
