const BASE = 'http://127.0.0.1:4000/api/v1';

export async function fetchJSON<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export interface ServiceSummary { id: string; name: string; environment: string; endpointUrl: string; overallStatus: string; hasDeps?: boolean; updatedAt: string; }

export function listServices() { return fetchJSON<ServiceSummary[]>('/services'); }

export function getGraph() { return fetchJSON<{ nodes: any[]; edges: any[] }>('/graph?includeExternal=true'); }

export interface CreateServiceInput {
  name: string;
  endpointUrl: string;
  environment?: string;
  pollIntervalOverrideSec?: number;
  dependencyKey?: string; // optional key name inside JSON where dependency array resides
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
  dependencyKey?: string;
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

export async function deleteService(id: string, apiKey: string): Promise<void> {
  const res = await fetch(`${BASE}/services/${id}`, { method: 'DELETE', headers: { 'x-api-key': apiKey }});
  if (!res.ok && res.status !== 204) throw new Error(await res.text());
}

export interface DependencyOverrideRow { dependencyName: string; mappedServiceId: string; mappedServiceName: string; mappedServiceEnvironment: string; }
export function listDependencyOverrides(serviceId: string) { return fetchJSON<DependencyOverrideRow[]>(`/services/${serviceId}/dependencies/overrides`); }
export async function upsertDependencyOverride(serviceId: string, dependencyName: string, mappedServiceId: string, apiKey: string) {
  const res = await fetch(`${BASE}/services/${serviceId}/dependencies/map`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
    body: JSON.stringify({ dependencyName, mappedServiceId })
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
export async function deleteDependencyOverride(serviceId: string, dependencyName: string, apiKey: string) {
  const res = await fetch(`${BASE}/services/${serviceId}/dependencies/map/${encodeURIComponent(dependencyName)}`, { method: 'DELETE', headers: { 'x-api-key': apiKey }});
  if (!res.ok && res.status !== 204) throw new Error(await res.text());
}
