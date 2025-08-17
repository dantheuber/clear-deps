import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { listServices, getGraph, createService, getService, getServiceDependencies, listDependencyOverrides, upsertDependencyOverride, deleteDependencyOverride } from '../api';

export function App() {
  const servicesQ = useQuery({ queryKey: ['services'], queryFn: listServices, refetchInterval: 10000 });
  const graphQ = useQuery({ queryKey: ['graph'], queryFn: getGraph, refetchInterval: 15000 });
  const qc = useQueryClient();
  const [apiKey, setApiKey] = useState('change-me-dev');
  const [form, setForm] = useState({ name: '', environment: 'default', endpointUrl: '' });
  const [selectedServiceId, setSelectedServiceId] = useState<string | undefined>();
  const createMut = useMutation({
    mutationFn: async () => {
      if (!form.name || !form.endpointUrl) throw new Error('name and endpointUrl required');
      return createService(form, apiKey);
    },
    onSuccess: () => {
      setForm({ name: '', environment: 'default', endpointUrl: '' });
      qc.invalidateQueries({ queryKey: ['services'] });
    }
  });

  return (
    <div style={{ fontFamily: 'system-ui', padding: 16 }}>
      <h1>clear-deps</h1>
      <section>
        <h2>Services</h2>
        <details style={{ marginBottom: 16 }}>
          <summary style={{ cursor: 'pointer', fontWeight: 600 }}>Add Service</summary>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 500, marginTop: 8 }}>
            <label style={{ display: 'flex', flexDirection: 'column', fontSize: 12, textTransform: 'uppercase', gap: 4 }}>API Key
              <input value={apiKey} onChange={e=>setApiKey(e.target.value)} placeholder="x-api-key" style={inputStyle} />
            </label>
            <label style={labelStyle}>Name
              <input value={form.name} onChange={e=>setForm(f=>({...f, name: e.target.value}))} placeholder="payments-api" style={inputStyle} />
            </label>
            <label style={labelStyle}>Environment
              <input value={form.environment} onChange={e=>setForm(f=>({...f, environment: e.target.value}))} placeholder="prod" style={inputStyle} />
            </label>
            <label style={labelStyle}>Endpoint URL
              <input value={form.endpointUrl} onChange={e=>setForm(f=>({...f, endpointUrl: e.target.value}))} placeholder="https://service.local/proactive-deps" style={inputStyle} />
            </label>
            <div>
              <button onClick={()=>createMut.mutate()} disabled={createMut.isPending} style={buttonStyle}>
                {createMut.isPending ? 'Creating...' : 'Create'}
              </button>
              {createMut.isError && <span style={{ color: '#dc2626', marginLeft: 8 }}>Error: {(createMut.error as Error).message}</span>}
              {createMut.isSuccess && <span style={{ color: '#16a34a', marginLeft: 8 }}>Created!</span>}
            </div>
          </div>
        </details>
        {servicesQ.isLoading && <p>Loading...</p>}
        {servicesQ.error && <p>Error loading services</p>}
  <table style={{ borderCollapse: 'collapse', minWidth: 600 }}>
          <thead>
            <tr><th align="left">Name</th><th>Env</th><th>Status</th><th>Endpoint</th></tr>
          </thead>
          <tbody>
      {servicesQ.data?.map(s => (
        <tr key={s.id} style={{ borderBottom: '1px solid #ddd', cursor: 'pointer' }} onClick={()=>setSelectedServiceId(s.id)}>
                <td>{s.name}</td>
                <td>{s.environment}</td>
                <td><StatusPill status={s.overallStatus} /></td>
                <td><code>{s.endpointUrl}</code></td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <ServiceDetailPanel serviceId={selectedServiceId} onClose={()=>setSelectedServiceId(undefined)} />
      <section style={{ marginTop: 32 }}>
        <h2>Graph (Counts)</h2>
        {graphQ.isLoading && <p>Loading graph...</p>}
        {graphQ.data && (
          <div>
            <p>Nodes: {graphQ.data.nodes.length} | Edges: {graphQ.data.edges.length}</p>
            <small>(Visualization TBD)</small>
          </div>
        )}
      </section>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const color = status === 'OK' ? '#16a34a' : status === 'WARN' ? '#f59e0b' : status === 'ERROR' ? '#dc2626' : '#64748b';
  return <span style={{ background: color, color: 'white', padding: '2px 8px', borderRadius: 12, fontSize: 12 }}>{status}</span>;
}

const inputStyle: React.CSSProperties = { padding: '6px 8px', border: '1px solid #cbd5e1', borderRadius: 4, fontSize: 14 };
const labelStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', fontSize: 12, textTransform: 'uppercase', gap: 4 };
const buttonStyle: React.CSSProperties = { padding: '6px 14px', background: '#2563eb', color: 'white', border: 'none', borderRadius: 4, cursor: 'pointer' };

function ServiceDetailPanel({ serviceId, onClose }: { serviceId?: string; onClose: () => void }) {
  const enabled = !!serviceId;
  const svcQ = useQuery({ queryKey: ['service', serviceId], queryFn: ()=>getService(serviceId!), enabled, refetchInterval: 15000 });
  const depsQ = useQuery({ queryKey: ['service', serviceId, 'deps'], queryFn: ()=>getServiceDependencies(serviceId!), enabled, refetchInterval: 15000 });
  const overridesQ = useQuery({ queryKey: ['service', serviceId, 'depOverrides'], queryFn: ()=>listDependencyOverrides(serviceId!), enabled, refetchInterval: 20000 });
  const qc = useQueryClient();
  const [apiKeyInput, setApiKeyInput] = useState('change-me-dev');
  const [selectedDepName, setSelectedDepName] = useState<string>('');
  const [mapToServiceId, setMapToServiceId] = useState<string>('');
  const upsertMut = useMutation({
    mutationFn: async () => {
      if (!selectedDepName || !mapToServiceId) throw new Error('dep + target required');
      return upsertDependencyOverride(serviceId!, selectedDepName, mapToServiceId, apiKeyInput);
    },
    onSuccess: ()=> { qc.invalidateQueries({ queryKey: ['service', serviceId, 'depOverrides']}); qc.invalidateQueries({ queryKey: ['service', serviceId, 'deps']}); }
  });
  const deleteMut = useMutation({
    mutationFn: async (depName: string) => deleteDependencyOverride(serviceId!, depName, apiKeyInput),
    onSuccess: ()=> { qc.invalidateQueries({ queryKey: ['service', serviceId, 'depOverrides']}); qc.invalidateQueries({ queryKey: ['service', serviceId, 'deps']}); }
  });
  if (!serviceId) return null;
  return (
    <aside style={{ position: 'fixed', top: 0, right: 0, width: 420, height: '100%', background: '#f8fafc', borderLeft: '1px solid #cbd5e1', padding: 16, overflowY: 'auto', boxShadow: '-4px 0 8px -2px rgba(0,0,0,0.08)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2 style={{ margin: 0, fontSize: 18 }}>Service Detail</h2>
        <button onClick={onClose} style={{ background: 'transparent', border: 'none', fontSize: 18, cursor: 'pointer' }}>×</button>
      </div>
      {svcQ.isLoading && <p>Loading...</p>}
      {svcQ.data && (
        <div style={{ marginTop: 8 }}>
          <div style={{ fontWeight: 600 }}>{svcQ.data.name}</div>
          <div style={{ fontSize: 12, color: '#475569' }}>Env: {svcQ.data.environment} • Status: <StatusPill status={svcQ.data.overallStatus} /></div>
          <div style={{ fontSize: 12, marginTop: 4 }}>Endpoint: <code>{svcQ.data.endpointUrl}</code></div>
          {svcQ.data.tags && Object.keys(svcQ.data.tags).length > 0 && (
            <div style={{ marginTop: 6 }}>
              <strong>Tags:</strong>
              <ul style={{ paddingLeft: 16, margin: '4px 0' }}>
                {Object.entries(svcQ.data.tags).map(([k,v])=> <li key={k} style={{ fontSize: 12 }}><code>{k}</code>: {String(v)}</li>)}
              </ul>
            </div>
          )}
        </div>
      )}
      <div style={{ marginTop: 16 }}>
        <h3 style={{ marginBottom: 4 }}>Dependencies</h3>
        {depsQ.isLoading && <p>Loading deps...</p>}
        {depsQ.data && depsQ.data.length === 0 && <p style={{ fontSize: 12 }}>No dependencies (yet)</p>}
        {depsQ.data && depsQ.data.length > 0 && (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead><tr><th align='left'>Name</th><th>Status</th><th>Type</th></tr></thead>
            <tbody>
              {depsQ.data.map(d => (
                <tr key={d.id} style={{ borderBottom: '1px solid #e2e8f0' }}>
                  <td style={{ padding: '2px 4px', cursor: 'pointer' }} onClick={()=> setSelectedDepName(d.name)}>
                    {d.mappedServiceId ? <strong>{d.name}</strong> : d.name}
                    {d.mappedServiceStatus && <span style={{ marginLeft: 4 }}><StatusPill status={d.mappedServiceStatus} /></span>}
                    {selectedDepName === d.name && <span style={{ marginLeft: 4, color: '#2563eb' }}>selected</span>}
                  </td>
                  <td style={{ padding: '2px 4px' }}><StatusPill status={d.status} /></td>
                  <td style={{ padding: '2px 4px', color: '#64748b' }}>{d.type || '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div style={{ marginTop: 12, background: '#fff', padding: 8, border: '1px solid #e2e8f0', borderRadius: 4 }}>
          <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Manual Mapping</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label style={{ display: 'flex', flexDirection: 'column', fontSize: 10, textTransform: 'uppercase', gap: 2 }}>API Key
              <input value={apiKeyInput} onChange={e=>setApiKeyInput(e.target.value)} style={inputStyle} />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', fontSize: 10, textTransform: 'uppercase', gap: 2 }}>Dependency Name
              <input value={selectedDepName} onChange={e=>setSelectedDepName(e.target.value)} placeholder='external-service' style={inputStyle} />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', fontSize: 10, textTransform: 'uppercase', gap: 2 }}>Map To Service ID
              <input value={mapToServiceId} onChange={e=>setMapToServiceId(e.target.value)} placeholder='target service id' style={inputStyle} />
            </label>
            <div>
              <button disabled={upsertMut.isPending} onClick={()=>upsertMut.mutate()} style={buttonStyle}>{upsertMut.isPending ? 'Saving...' : 'Save Mapping'}</button>
              {upsertMut.isError && <span style={{ color: '#dc2626', marginLeft: 6 }}>Err</span>}
              {upsertMut.isSuccess && <span style={{ color: '#16a34a', marginLeft: 6 }}>Saved</span>}
            </div>
            <div style={{ fontSize: 11, color: '#475569' }}>Overrides:</div>
            {overridesQ.data && overridesQ.data.length === 0 && <div style={{ fontSize: 11 }}>None</div>}
            {overridesQ.data && overridesQ.data.length > 0 && (
              <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
                {overridesQ.data.map(o => (
                  <li key={o.dependencyName} style={{ background: '#f1f5f9', padding: '4px 6px', borderRadius: 4, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span><code>{o.dependencyName}</code> → <strong>{o.mappedServiceName}</strong></span>
                    <button onClick={()=>deleteMut.mutate(o.dependencyName)} style={{ background: 'transparent', border: 'none', color: '#dc2626', cursor: 'pointer', fontSize: 12 }}>✕</button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </aside>
  );
}
