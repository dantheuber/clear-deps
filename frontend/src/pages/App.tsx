import React, { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { listServices, getGraph, createService, getService, getServiceDependencies, listDependencyOverrides, upsertDependencyOverride, deleteDependencyOverride, deleteService } from '../api';

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
            <tr><th align="left">Name</th><th>Env</th><th>Status</th><th>Endpoint</th><th></th></tr>
          </thead>
          <tbody>
      {servicesQ.data?.map(s => (
        <tr key={s.id} style={{ borderBottom: '1px solid #ddd' }}>
                <td style={{ cursor: 'pointer' }} onClick={()=>setSelectedServiceId(s.id)}>{s.name}</td>
                <td>{s.environment}</td>
                <td><StatusPill status={s.overallStatus} /></td>
                <td><code>{s.endpointUrl}</code></td>
                <td>
                  <button onClick={(e)=>{ e.stopPropagation(); if (confirm(`Delete service ${s.name}?`)) { deleteService(s.id, apiKey).then(()=>{ qc.invalidateQueries({ queryKey: ['services']}); if (selectedServiceId===s.id) setSelectedServiceId(undefined); }).catch(err=>alert('Delete failed: '+err.message)); } }} style={{ background: 'transparent', border: 'none', color: '#dc2626', cursor: 'pointer', fontSize: 12 }}>Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
  <ServiceDetailPanel serviceId={selectedServiceId} allServices={servicesQ.data || []} onClose={()=>setSelectedServiceId(undefined)} />
      <section style={{ marginTop: 32 }}>
        <h2>Graph (Counts)</h2>
        {graphQ.isLoading && <p>Loading graph...</p>}
        {graphQ.data && (
          <div>
            <p>Nodes: {graphQ.data.nodes.length} | Edges: {graphQ.data.edges.length}</p>
            <GraphVis data={graphQ.data} selectedId={selectedServiceId} onSelectService={id=>setSelectedServiceId(id.startsWith('ext:')? undefined : id)} />
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

interface ServiceLite { id: string; name: string; environment: string; endpointUrl: string; overallStatus: string; updatedAt: string; }
function ServiceDetailPanel({ serviceId, allServices, onClose }: { serviceId?: string; allServices: ServiceLite[]; onClose: () => void }) {
  const enabled = !!serviceId;
  const svcQ = useQuery({ queryKey: ['service', serviceId], queryFn: ()=>getService(serviceId!), enabled, refetchInterval: 15000 });
  const depsQ = useQuery({ queryKey: ['service', serviceId, 'deps'], queryFn: ()=>getServiceDependencies(serviceId!), enabled, refetchInterval: 15000 });
  const overridesQ = useQuery({ queryKey: ['service', serviceId, 'depOverrides'], queryFn: ()=>listDependencyOverrides(serviceId!), enabled, refetchInterval: 20000 });
  const qc = useQueryClient();
  const [apiKeyInput, setApiKeyInput] = useState('change-me-dev');
  const [selectedDepName, setSelectedDepName] = useState<string>('');
  const selectedDep = depsQ.data?.find(d=>d.name === selectedDepName);
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
        {selectedDep && (
          <div style={{ marginTop: 8, padding: 8, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 4 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <strong style={{ fontSize: 12 }}>Dependency Details: {selectedDep.name}</strong>
              <button onClick={()=>setSelectedDepName('')} style={{ background: 'transparent', border: 'none', cursor: 'pointer', fontSize: 12 }}>close</button>
            </div>
            <div style={{ fontSize: 11, marginTop: 4 }}>Type: <code>{selectedDep.type || 'n/a'}</code></div>
            <div style={{ fontSize: 11, marginTop: 4 }}>Status: <StatusPill status={selectedDep.status} /></div>
            {selectedDep.meta && selectedDep.meta.checkDetails && (
              <div style={{ fontSize: 11, marginTop: 6 }}>
                <div style={{ fontWeight: 600 }}>Check Details</div>
                <pre style={{ fontSize: 11, background: '#f1f5f9', padding: 6, borderRadius: 4, maxHeight: 200, overflow: 'auto' }}>{JSON.stringify(selectedDep.meta.checkDetails, null, 2)}</pre>
              </div>
            )}
            {selectedDep.meta && !selectedDep.meta.checkDetails && (
              <div style={{ fontSize: 11, marginTop: 6 }}>
                <div style={{ fontWeight: 600 }}>Meta</div>
                <pre style={{ fontSize: 11, background: '#f1f5f9', padding: 6, borderRadius: 4, maxHeight: 200, overflow: 'auto' }}>{JSON.stringify(selectedDep.meta, null, 2)}</pre>
              </div>
            )}
          </div>
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
            <label style={{ display: 'flex', flexDirection: 'column', fontSize: 10, textTransform: 'uppercase', gap: 2 }}>Map To Service
              <select value={mapToServiceId} onChange={e=>setMapToServiceId(e.target.value)} style={{ ...inputStyle, padding: '4px 6px' }}>
                <option value=''>-- select service --</option>
                {allServices.filter(s=>s.id !== serviceId).map(s => (
                  <option key={s.id} value={s.id}>{s.name} ({s.environment})</option>
                ))}
              </select>
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

// --- Graph Visualization ---
import { forceSimulation, forceLink, forceManyBody, forceCenter, forceCollide } from 'd3-force';

interface GraphData { nodes: Array<{ id: string; name: string; status: string; environment?: string | null; external?: boolean }>; edges: Array<{ from: string; to: string; name: string; status: string; latencyMs?: number }>; }

function GraphVis({ data, selectedId, onSelectService }: { data: GraphData; selectedId?: string; onSelectService: (id: string)=>void }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [dims, setDims] = useState({ w: 1000, h: 700 });
  // interaction refs
  const transformRef = useRef({ scale: 1, tx: 0, ty: 0 });
  const nodesRef = useRef<any[]>([]);
  const linksRef = useRef<any[]>([]);
  const simRef = useRef<any>(null);
  const dragRef = useRef<{ node?: any; mode?: 'pan' | 'node'; startX: number; startY: number; origTx: number; origTy: number; moved: boolean }>({ startX:0, startY:0, origTx:0, origTy:0, moved:false });
  // selected node ref so tick handler always sees current selection
  const selectedIdRef = useRef<string | undefined>(selectedId);
  // live data ref for status/color updates without tearing down simulation
  const dataRef = useRef<GraphData>(data);
  useEffect(()=>{ dataRef.current = data; }, [data]);
  useEffect(()=>{ selectedIdRef.current = selectedId; if (simRef.current) { simRef.current.alpha(0.05).restart(); } else { // if no sim yet trigger a manual redraw by resizing
    setDims(d=>({...d}));
  } }, [selectedId]);
  useEffect(()=>{
  function handle() { setDims({ w: Math.min(window.innerWidth-48, 1400), h: Math.min(window.innerHeight-220, 900) }); }
    handle();
    window.addEventListener('resize', handle); return ()=>window.removeEventListener('resize', handle);
  },[]);
  useEffect(()=>{
    if (!canvasRef.current) return;
    const ctx = canvasRef.current.getContext('2d');
    if (!ctx) return;
    // Capture previous node positions & fixed states
    const prevMap = new Map<string, any>();
    for (const pn of nodesRef.current) {
      prevMap.set(pn.id, { x: pn.x, y: pn.y, vx: pn.vx, vy: pn.vy, fx: pn.fx, fy: pn.fy });
    }
    const nodes: any[] = data.nodes.map(n=>{
      const base: any = { ...n };
      const prev = prevMap.get(n.id);
      if (prev) {
        base.x = prev.x; base.y = prev.y;
        // carry over velocity for smooth transition
        if (typeof prev.vx === 'number') base.vx = prev.vx;
        if (typeof prev.vy === 'number') base.vy = prev.vy;
        if (prev.fx !== undefined) base.fx = prev.fx;
        if (prev.fy !== undefined) base.fy = prev.fy;
      }
      return base;
    });
  const links: any[] = data.edges.map(e=>({ source: e.from, target: e.to, name: e.name, status: e.status, latencyMs: e.latencyMs, _key: `${e.to}<-${e.from}::${e.name}` }));
    nodesRef.current = nodes;
    linksRef.current = links;
    // stop previous sim if exists
    if (simRef.current) simRef.current.stop();
    const sim = forceSimulation(nodes)
      .force('link', forceLink(links).id((d: any)=>d.id).distance(()=>160).strength(0.55))
      .force('charge', forceManyBody().strength(-400))
      .force('center', forceCenter(dims.w/2, dims.h/2))
      .force('collide', forceCollide().radius(70));
    // If there were previous positions, start with lower alpha to avoid drastic movement
    if (prevMap.size > 0) {
      sim.alpha(0.4);
    }
    simRef.current = sim;
    function statusColor(status: string) {
      return status === 'OK' ? '#16a34a' : status === 'WARN' ? '#f59e0b' : status === 'ERROR' ? '#dc2626' : '#64748b';
    }
    function boundaryDistance(node: any, ux: number, uy: number) {
      // distance from center to boundary along direction (ux,uy)
      if (node.external) {
        const r = 20; // external circle radius
        return r;
      } else {
        const halfW = 36; // internal square half width (square width 72)
        const halfH = 22; // internal square half height (height 44)
        const tx = halfW / (Math.abs(ux) || 1e-6);
        const ty = halfH / (Math.abs(uy) || 1e-6);
        return Math.min(tx, ty);
      }
    }
    function drawArrow(from: any, to: any, color: string) {
      if (!ctx) return { mx: from.x, my: from.y };
      const dx = to.x - from.x; const dy = to.y - from.y;
      const dist = Math.sqrt(dx*dx + dy*dy) || 1;
      const ux = dx / dist; const uy = dy / dist;
      const startPad = boundaryDistance(from, ux, uy);
      const endPad = boundaryDistance(to, -ux, -uy) + 6; // gap + arrowhead space
      const startX = from.x + ux * startPad;
      const startY = from.y + uy * startPad;
      const endX = to.x - ux * endPad;
      const endY = to.y - uy * endPad;
      // respect caller's lineWidth & globalAlpha; only set strokeStyle
      ctx.strokeStyle = color;
      ctx.beginPath(); ctx.moveTo(startX, startY); ctx.lineTo(endX, endY); ctx.stroke();
      // arrowhead (also respect alpha already set)
      const ahLen = 10; const ahW = 6;
      const baseX = endX - ux * ahLen;
      const baseY = endY - uy * ahLen;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(endX, endY);
      ctx.lineTo(baseX + (-uy)*ahW, baseY + (ux)*ahW);
      ctx.lineTo(baseX + (uy)*ahW, baseY + (-ux)*ahW);
      ctx.closePath();
      ctx.fill();
      // perpendicular normal (for label offset)
      const nx = -uy; const ny = ux;
      return { mx: (startX+endX)/2, my: (startY+endY)/2, nx, ny };
    }
    sim.on('tick', ()=>{
      // reset & clear
      ctx.setTransform(1,0,0,1,0,0);
      ctx.clearRect(0,0,dims.w,dims.h);
      // apply pan/zoom
      const { scale, tx, ty } = transformRef.current;
      ctx.setTransform(scale,0,0,scale,tx,ty);
      // sync dynamic status changes without rebuilding simulation
      const latest = dataRef.current;
      if (latest) {
        const statusMap = new Map<string,string>();
        for (const n of latest.nodes) statusMap.set(n.id, n.status);
        for (const n of nodes) if (statusMap.has(n.id)) n.status = statusMap.get(n.id);
        const edgeStatusKey = new Map<string,string>();
        for (const e of latest.edges) edgeStatusKey.set(`${e.from}|${e.to}|${e.name}`, e.status);
        for (const l of links) {
          const sId = (l.source && l.source.id)? l.source.id : l.source;
          const tId = (l.target && l.target.id)? l.target.id : l.target;
          const key = `${sId}|${tId}|${l.name}`;
          if (edgeStatusKey.has(key)) l.status = edgeStatusKey.get(key);
        }
      }
      // compute upstream highlight chain for selectedId (dependencies that lead to selected service)
      let highlightEdgeSet: Set<any> | null = null;
      let highlightNodeSet: Set<string> | null = null;
      const selId = selectedIdRef.current;
      if (selId) {
        // Determine orientation: are links stored provider->dependent or dependent->provider?
        // We'll sample edges involving the selected node.
        let anyTargetMatches = false; let anySourceMatches = false;
        for (const l of links) {
          const sId = (l.source && l.source.id) ? l.source.id : l.source;
          const tId = (l.target && l.target.id) ? l.target.id : l.target;
          if (tId === selId) anyTargetMatches = true;
          if (sId === selId) anySourceMatches = true;
          if (anyTargetMatches && anySourceMatches) break;
        }
        const orientation: 'providerDependent' | 'dependentProvider' | 'unknown' = anyTargetMatches && !anySourceMatches ? 'providerDependent' : (!anyTargetMatches && anySourceMatches ? 'dependentProvider' : (anyTargetMatches ? 'providerDependent' : 'unknown'));
        const queue: string[] = [selId];
        const visited = new Set<string>([selId]);
        const edgesUp = new Set<any>();
        const nodesUp = new Set<string>([selId]);
        while (queue.length) {
          const current = queue.shift()!;
          for (const l of links) {
            const sId = (l.source && l.source.id) ? l.source.id : l.source;
            const tId = (l.target && l.target.id) ? l.target.id : l.target;
            if (orientation === 'providerDependent') {
              // provider->dependent, so find edges whose dependent == current, move to provider
              if (tId === current) {
                const providerId = sId;
                if (!visited.has(providerId)) { visited.add(providerId); queue.push(providerId); }
                edgesUp.add(l); nodesUp.add(providerId);
              }
            } else if (orientation === 'dependentProvider') {
              // dependent->provider (inverted storage). Providers are target side.
              if (sId === current) {
                const providerId = tId;
                if (!visited.has(providerId)) { visited.add(providerId); queue.push(providerId); }
                edgesUp.add(l); nodesUp.add(providerId);
              }
            } else {
              // unknown orientation; skip
            }
          }
        }
        if (edgesUp.size > 0) {
          highlightEdgeSet = edgesUp;
          highlightNodeSet = nodesUp;
        }
      }
      // Edges first
      for (const l of links) {
        const origFrom: any = l.source; const origTo: any = l.target;
        // Reverse: show arrow from provider (origTo) to dependent (origFrom)
        let from = origTo; let to = origFrom;
        const color = statusColor(l.status);
        const highlighted = highlightEdgeSet ? highlightEdgeSet.has(l) : false;
        // adjust styling for highlight
        const prevLineWidth = ctx.lineWidth;
        const prevAlpha = ctx.globalAlpha;
        if (!highlighted && highlightEdgeSet) {
          ctx.globalAlpha = 0.15;
          ctx.lineWidth = 2;
        } else if (highlighted) {
          ctx.globalAlpha = 1;
          ctx.lineWidth = 4;
        } else {
          ctx.globalAlpha = 0.55;
          ctx.lineWidth = 2;
        }
        const mid = drawArrow(from, to, color);
        ctx.lineWidth = prevLineWidth;
        ctx.globalAlpha = prevAlpha;
        // show latency label if provided (including 0)
        if (l.latencyMs !== undefined && l.latencyMs !== null && (!highlightEdgeSet || highlightEdgeSet.has(l))) {
          const label = `${l.latencyMs}ms`;
          ctx.save();
          // keep font size independent of zoom
          ctx.setTransform(1,0,0,1,0,0);
          ctx.font = '10px system-ui';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          // offset label slightly off the arrow line using perpendicular normal
          const off = 14;
          const nx = (mid as any).nx ?? 0; const ny = (mid as any).ny ?? -1; // default perpendicular up if missing
          // transform world -> screen for label placement, then offset in screen space for consistency
          const { scale, tx, ty } = transformRef.current;
          const sx = mid.mx * scale + tx; const sy = mid.my * scale + ty;
          const lx = sx + nx * off; const ly = sy + ny * off;
          // background pill
          const metrics = ctx.measureText(label);
          const padX = 4; const padY = 2;
          const textW = metrics.width; const textH = 10; // approx
          ctx.fillStyle = 'rgba(255,255,255,0.85)';
          ctx.strokeStyle = color;
          ctx.lineWidth = 0.5;
          const rx = lx - textW/2 - padX; const ry = ly - textH/2 - padY; const rw = textW + padX*2; const rh = textH + padY*2;
          const r = 4;
          ctx.beginPath();
          ctx.moveTo(rx + r, ry);
          ctx.lineTo(rx + rw - r, ry);
          ctx.quadraticCurveTo(rx + rw, ry, rx + rw, ry + r);
          ctx.lineTo(rx + rw, ry + rh - r);
          ctx.quadraticCurveTo(rx + rw, ry + rh, rx + rw - r, ry + rh);
          ctx.lineTo(rx + r, ry + rh);
          ctx.quadraticCurveTo(rx, ry + rh, rx, ry + rh - r);
          ctx.lineTo(rx, ry + r);
          ctx.quadraticCurveTo(rx, ry, rx + r, ry);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
          // text
          ctx.fillStyle = '#0f172a';
          ctx.fillText(label, lx, ly + 1);
          ctx.restore();
        }
      }
      // Nodes
      for (const n of nodes) {
        const inHighlight = highlightNodeSet ? highlightNodeSet.has(n.id) : false;
        const strokeW = inHighlight ? 4 : 3;
        ctx.lineWidth = strokeW;
        ctx.strokeStyle = statusColor(n.status);
        ctx.fillStyle = inHighlight ? '#f0f9ff' : '#ffffff';
        if (n.external) {
          // circle for external dependency
            ctx.beginPath();
            const r = 20;
            ctx.arc(n.x, n.y, r, 0, Math.PI*2);
            ctx.fill();
            ctx.stroke();
        } else {
          // square for internal service
          const halfW = 36; const halfH = 22;
          ctx.beginPath();
          ctx.rect(n.x - halfW, n.y - halfH, halfW*2, halfH*2);
          ctx.fill();
          ctx.stroke();
        }
        // label inside shape (screen-space so it's stable vs zoom)
        ctx.save();
        ctx.setTransform(1,0,0,1,0,0);
        const { scale, tx, ty } = transformRef.current;
        const sx = n.x * scale + tx; const sy = n.y * scale + ty;
        ctx.font = '11px system-ui';
        ctx.fillStyle = '#0f172a';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const maxLen = n.external ? 14 : 18;
        let label = n.name;
        if (label.length > maxLen) label = label.slice(0, maxLen-1) + '…';
        ctx.fillText(label, sx, sy);
        ctx.restore();
      }
    });
    return ()=>{ sim.stop(); };
  }, [data, dims.w, dims.h]);
  // capture clicks
  useEffect(()=>{
    const canvas = canvasRef.current; if (!canvas) return;
    function toWorld(x: number, y: number) {
      const { scale, tx, ty } = transformRef.current;
      return { wx: (x - tx)/scale, wy: (y - ty)/scale };
    }
    function hitNode(wx: number, wy: number) {
      // iterate in reverse for top-most
      for (let i = nodesRef.current.length-1; i>=0; i--) {
        const n = nodesRef.current[i];
        const r = n.external ? 18 : 28;
        const dx = wx - n.x; const dy = wy - n.y;
        if (dx*dx + dy*dy <= r*r) return n;
      }
      return undefined;
    }
    function onWheel(ev: WheelEvent) {
      ev.preventDefault();
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
      const x = ev.clientX - rect.left; const y = ev.clientY - rect.top;
      const { scale, tx, ty } = transformRef.current;
      const world = toWorld(x,y);
      const delta = -ev.deltaY * 0.001; // smooth
      let newScale = scale * (1 + delta);
      newScale = Math.min(3, Math.max(0.3, newScale));
      transformRef.current.scale = newScale;
      // keep cursor position stable
      transformRef.current.tx = x - world.wx * newScale;
      transformRef.current.ty = y - world.wy * newScale;
    }
    function onDown(ev: MouseEvent) {
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
      const x = ev.clientX - rect.left; const y = ev.clientY - rect.top;
      const { wx, wy } = toWorld(x,y);
      const node = hitNode(wx, wy);
      dragRef.current.node = node;
      dragRef.current.mode = node ? 'node' : 'pan';
      dragRef.current.startX = x; dragRef.current.startY = y; dragRef.current.origTx = transformRef.current.tx; dragRef.current.origTy = transformRef.current.ty; dragRef.current.moved = false;
      if (node) {
        // lock node position for dragging
        node.fx = node.x; node.fy = node.y;
        if (simRef.current) simRef.current.alphaTarget(0.3).restart();
        canvas.style.cursor = 'grabbing';
      } else {
        canvas.style.cursor = 'grabbing';
      }
    }
    function onMove(ev: MouseEvent) {
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
  if (canvas) canvas.style.cursor = 'grabbing';
  if (canvas) canvas.style.cursor = 'grabbing';
      const x = ev.clientX - rect.left; const y = ev.clientY - rect.top;
      if (dragRef.current.mode === 'node' && dragRef.current.node) {
        dragRef.current.moved = true;
        const { wx, wy } = toWorld(x,y);
        dragRef.current.node.fx = wx;
        dragRef.current.node.fy = wy;
      } else if (dragRef.current.mode === 'pan') {
        const dx = x - dragRef.current.startX; const dy = y - dragRef.current.startY;
        if (Math.abs(dx) > 2 || Math.abs(dy) > 2) dragRef.current.moved = true;
        transformRef.current.tx = dragRef.current.origTx + dx;
        transformRef.current.ty = dragRef.current.origTy + dy;
      } else {
        // hover state
        const { wx, wy } = toWorld(x,y);
        const hoverNode = hitNode(wx, wy);
        canvas.style.cursor = hoverNode ? 'grab' : 'default';
  if (canvas) canvas.style.cursor = hoverNode ? 'grab' : 'default';
      }
    }
    function onUp(ev: MouseEvent) {
      const wasNode = dragRef.current.mode === 'node';
      const node = dragRef.current.node;
      if (wasNode && node) {
        // release but keep fixed position
        if (simRef.current) simRef.current.alphaTarget(0);
  if (canvas) canvas.style.cursor = 'grab';
  if (canvas) canvas.style.cursor = 'grab';
        if (!dragRef.current.moved) {
          onSelectService(node.id);
        }
      } else if (!dragRef.current.moved) {
        // background click -> deselect maybe
        // onSelectService(undefined as any); // leave untouched
      }
      dragRef.current.mode = undefined; dragRef.current.node = undefined; dragRef.current.moved = false;
  if (canvas) canvas.style.cursor = 'default';
  if (canvas) canvas.style.cursor = 'default';
    }
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('mousedown', onDown);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return ()=>{
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('mousedown', onDown);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [onSelectService]);
  return <canvas ref={canvasRef} width={dims.w} height={dims.h} style={{ maxWidth: '100%', border: '1px solid #e2e8f0', background: '#ffffff', borderRadius: 4 }} />;
}
