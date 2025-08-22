import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import React, { useState, useEffect, useRef } from 'react';

import {
  listServices,
  getGraph,
  createService,
  getService,
  getServiceDependencies,
  listDependencyOverrides,
  upsertDependencyOverride,
  deleteDependencyOverride,
  deleteService,
} from '../api';

export function App() {
  const servicesQ = useQuery({
    queryKey: ['services'],
    queryFn: listServices,
    refetchInterval: 10000,
  });
  const graphQ = useQuery({ queryKey: ['graph'], queryFn: getGraph, refetchInterval: 15000 });
  const qc = useQueryClient();
  const [apiKey, setApiKey] = useState('change-me-dev');
  const [form, setForm] = useState({
    name: '',
    environment: 'default',
    endpointUrl: '',
    dependencyKey: '',
  });
  const [selectedServiceId, setSelectedServiceId] = useState<string | undefined>();
  const createMut = useMutation({
    mutationFn: async () => {
      if (!form.name || !form.endpointUrl) throw new Error('name and endpointUrl required');
      const payload: any = { ...form };
      if (!payload.dependencyKey) delete payload.dependencyKey; // omit empty
      return createService(payload, apiKey);
    },
    onSuccess: () => {
      setForm({ name: '', environment: 'default', endpointUrl: '', dependencyKey: '' });
      qc.invalidateQueries({ queryKey: ['services'] });
    },
  });

  return (
    <div style={{ fontFamily: 'system-ui', padding: 16 }}>
      <h1>clear-deps</h1>
      <section>
        <h2>Services</h2>
        <details style={{ marginBottom: 16 }}>
          <summary style={{ cursor: 'pointer', fontWeight: 600 }}>Add Service</summary>
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
              maxWidth: 500,
              marginTop: 8,
            }}
          >
            <label
              style={{
                display: 'flex',
                flexDirection: 'column',
                fontSize: 12,
                textTransform: 'uppercase',
                gap: 4,
              }}
            >
              API Key
              <input
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="x-api-key"
                style={inputStyle}
              />
            </label>
            <label style={labelStyle}>
              Name
              <input
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="payments-api"
                style={inputStyle}
              />
            </label>
            <label style={labelStyle}>
              Environment
              <input
                value={form.environment}
                onChange={(e) => setForm((f) => ({ ...f, environment: e.target.value }))}
                placeholder="prod"
                style={inputStyle}
              />
            </label>
            <label style={labelStyle}>
              Endpoint URL
              <input
                value={form.endpointUrl}
                onChange={(e) => setForm((f) => ({ ...f, endpointUrl: e.target.value }))}
                placeholder="https://service.local/proactive-deps"
                style={inputStyle}
              />
            </label>
            <label style={labelStyle}>
              Dependency Key
              <input
                value={form.dependencyKey}
                onChange={(e) => setForm((f) => ({ ...f, dependencyKey: e.target.value }))}
                placeholder="dependencies (optional)"
                style={inputStyle}
              />
            </label>
            <div>
              <button
                onClick={() => createMut.mutate()}
                disabled={createMut.isPending}
                style={buttonStyle}
              >
                {createMut.isPending ? 'Creating...' : 'Create'}
              </button>
              {createMut.isError && (
                <span style={{ color: '#dc2626', marginLeft: 8 }}>
                  Error: {(createMut.error as Error).message}
                </span>
              )}
              {createMut.isSuccess && (
                <span style={{ color: '#16a34a', marginLeft: 8 }}>Created!</span>
              )}
            </div>
          </div>
        </details>
        {servicesQ.isLoading && <p>Loading...</p>}
        {servicesQ.error && <p>Error loading services</p>}
        <table style={{ borderCollapse: 'collapse', minWidth: 650 }}>
          <thead>
            <tr>
              <th align="left">Name</th>
              <th>Env</th>
              <th>Status</th>
              <th>Deps?</th>
              <th>Endpoint</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {servicesQ.data?.map((s) => (
              <tr key={s.id} style={{ borderBottom: '1px solid #ddd' }}>
                <td style={{ cursor: 'pointer' }} onClick={() => setSelectedServiceId(s.id)}>
                  {s.name}
                </td>
                <td>{s.environment}</td>
                <td>
                  <StatusPill status={s.overallStatus} />
                </td>
                <td style={{ textAlign: 'center', fontSize: 12 }}>{s.hasDeps ? '✔️' : '—'}</td>
                <td>
                  <code>{s.endpointUrl}</code>
                </td>
                <td>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      if (confirm(`Delete service ${s.name}?`)) {
                        deleteService(s.id, apiKey)
                          .then(() => {
                            qc.invalidateQueries({ queryKey: ['services'] });
                            if (selectedServiceId === s.id) setSelectedServiceId(undefined);
                          })
                          .catch((err) => alert('Delete failed: ' + err.message));
                      }
                    }}
                    style={{
                      background: 'transparent',
                      border: 'none',
                      color: '#dc2626',
                      cursor: 'pointer',
                      fontSize: 12,
                    }}
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <ServiceDetailPanel
        serviceId={selectedServiceId}
        allServices={servicesQ.data || []}
        onClose={() => setSelectedServiceId(undefined)}
      />
      <section style={{ marginTop: 32 }}>
        <h2>Graph (Counts)</h2>
        {graphQ.isLoading && <p>Loading graph...</p>}
        {graphQ.data && (
          <div>
            <p>
              Nodes: {graphQ.data.nodes.length} | Edges: {graphQ.data.edges.length}
            </p>
            <GraphVis
              data={graphQ.data}
              selectedId={selectedServiceId}
              onSelectService={(id) => setSelectedServiceId(id.startsWith('ext:') ? undefined : id)}
            />
          </div>
        )}
      </section>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const color =
    status === 'OK'
      ? '#16a34a'
      : status === 'WARN'
        ? '#f59e0b'
        : status === 'ERROR'
          ? '#dc2626'
          : '#64748b';
  return (
    <span
      style={{
        background: color,
        color: 'white',
        padding: '2px 8px',
        borderRadius: 12,
        fontSize: 12,
      }}
    >
      {status}
    </span>
  );
}

const inputStyle: React.CSSProperties = {
  padding: '6px 8px',
  border: '1px solid #cbd5e1',
  borderRadius: 4,
  fontSize: 14,
};
const labelStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  fontSize: 12,
  textTransform: 'uppercase',
  gap: 4,
};
const buttonStyle: React.CSSProperties = {
  padding: '6px 14px',
  background: '#2563eb',
  color: 'white',
  border: 'none',
  borderRadius: 4,
  cursor: 'pointer',
};

interface ServiceLite {
  id: string;
  name: string;
  environment: string;
  endpointUrl: string;
  overallStatus: string;
  updatedAt: string;
}
function ServiceDetailPanel({
  serviceId,
  allServices,
  onClose,
}: {
  serviceId?: string;
  allServices: ServiceLite[];
  onClose: () => void;
}) {
  const enabled = !!serviceId;
  const svcQ = useQuery({
    queryKey: ['service', serviceId],
    queryFn: () => getService(serviceId!),
    enabled,
    refetchInterval: 15000,
  });
  const depsQ = useQuery({
    queryKey: ['service', serviceId, 'deps'],
    queryFn: () => getServiceDependencies(serviceId!),
    enabled,
    refetchInterval: 15000,
  });
  const overridesQ = useQuery({
    queryKey: ['service', serviceId, 'depOverrides'],
    queryFn: () => listDependencyOverrides(serviceId!),
    enabled,
    refetchInterval: 20000,
  });
  const qc = useQueryClient();
  const [apiKeyInput, setApiKeyInput] = useState('change-me-dev');
  const [selectedDepName, setSelectedDepName] = useState<string>('');
  const selectedDep = depsQ.data?.find((d) => d.name === selectedDepName);
  const [mapToServiceId, setMapToServiceId] = useState<string>('');
  const upsertMut = useMutation({
    mutationFn: async () => {
      if (!selectedDepName || !mapToServiceId) throw new Error('dep + target required');
      return upsertDependencyOverride(serviceId!, selectedDepName, mapToServiceId, apiKeyInput);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['service', serviceId, 'depOverrides'] });
      qc.invalidateQueries({ queryKey: ['service', serviceId, 'deps'] });
    },
  });
  const deleteMut = useMutation({
    mutationFn: async (depName: string) =>
      deleteDependencyOverride(serviceId!, depName, apiKeyInput),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['service', serviceId, 'depOverrides'] });
      qc.invalidateQueries({ queryKey: ['service', serviceId, 'deps'] });
    },
  });
  if (!serviceId) return null;
  return (
    <aside
      style={{
        position: 'fixed',
        top: 0,
        right: 0,
        width: 420,
        height: '100%',
        background: '#f8fafc',
        borderLeft: '1px solid #cbd5e1',
        padding: 16,
        overflowY: 'auto',
        boxShadow: '-4px 0 8px -2px rgba(0,0,0,0.08)',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2 style={{ margin: 0, fontSize: 18 }}>Service Detail</h2>
        <button
          onClick={onClose}
          style={{ background: 'transparent', border: 'none', fontSize: 18, cursor: 'pointer' }}
        >
          ×
        </button>
      </div>
      {svcQ.isLoading && <p>Loading...</p>}
      {svcQ.data && (
        <div style={{ marginTop: 8 }}>
          <div style={{ fontWeight: 600 }}>{svcQ.data.name}</div>
          <div style={{ fontSize: 12, color: '#475569' }}>
            Env: {svcQ.data.environment} • Status: <StatusPill status={svcQ.data.overallStatus} />
          </div>
          <div style={{ fontSize: 12, marginTop: 4 }}>
            Endpoint: <code>{svcQ.data.endpointUrl}</code>
          </div>
          {svcQ.data.tags && Object.keys(svcQ.data.tags).length > 0 && (
            <div style={{ marginTop: 6 }}>
              <strong>Tags:</strong>
              <ul style={{ paddingLeft: 16, margin: '4px 0' }}>
                {Object.entries(svcQ.data.tags).map(([k, v]) => (
                  <li key={k} style={{ fontSize: 12 }}>
                    <code>{k}</code>: {String(v)}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
      <div style={{ marginTop: 16 }}>
        <h3 style={{ marginBottom: 4 }}>Dependencies</h3>
        {depsQ.isLoading && <p>Loading deps...</p>}
        {depsQ.data && depsQ.data.length === 0 && (
          <p style={{ fontSize: 12 }}>No dependencies (yet)</p>
        )}
        {depsQ.data && depsQ.data.length > 0 && (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr>
                <th align="left">Name</th>
                <th>Status</th>
                <th>Type</th>
              </tr>
            </thead>
            <tbody>
              {depsQ.data.map((d) => (
                <tr key={d.id} style={{ borderBottom: '1px solid #e2e8f0' }}>
                  <td
                    style={{ padding: '2px 4px', cursor: 'pointer' }}
                    onClick={() => setSelectedDepName(d.name)}
                  >
                    {d.mappedServiceId ? <strong>{d.name}</strong> : d.name}
                    {d.mappedServiceStatus && (
                      <span style={{ marginLeft: 4 }}>
                        <StatusPill status={d.mappedServiceStatus} />
                      </span>
                    )}
                    {selectedDepName === d.name && (
                      <span style={{ marginLeft: 4, color: '#2563eb' }}>selected</span>
                    )}
                  </td>
                  <td style={{ padding: '2px 4px' }}>
                    <StatusPill status={d.status} />
                  </td>
                  <td style={{ padding: '2px 4px', color: '#64748b' }}>{d.type || '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {selectedDep && (
          <div
            style={{
              marginTop: 8,
              padding: 8,
              background: '#fff',
              border: '1px solid #e2e8f0',
              borderRadius: 4,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <strong style={{ fontSize: 12 }}>Dependency Details: {selectedDep.name}</strong>
              <button
                onClick={() => setSelectedDepName('')}
                style={{
                  background: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  fontSize: 12,
                }}
              >
                close
              </button>
            </div>
            <div style={{ fontSize: 11, marginTop: 4 }}>
              Type: <code>{selectedDep.type || 'n/a'}</code>
            </div>
            <div style={{ fontSize: 11, marginTop: 4 }}>
              Status: <StatusPill status={selectedDep.status} />
            </div>
            {selectedDep.meta && selectedDep.meta.checkDetails && (
              <div style={{ fontSize: 11, marginTop: 6 }}>
                <div style={{ fontWeight: 600 }}>Check Details</div>
                <pre
                  style={{
                    fontSize: 11,
                    background: '#f1f5f9',
                    padding: 6,
                    borderRadius: 4,
                    maxHeight: 200,
                    overflow: 'auto',
                  }}
                >
                  {JSON.stringify(selectedDep.meta.checkDetails, null, 2)}
                </pre>
              </div>
            )}
            {selectedDep.meta && selectedDep.meta.errorMessage && (
              <div style={{ fontSize: 11, marginTop: 6 }}>
                <div style={{ fontWeight: 600, color: '#dc2626' }}>Error Message</div>
                <div
                  style={{
                    background: '#fef2f2',
                    color: '#991b1b',
                    padding: 6,
                    borderRadius: 4,
                    border: '1px solid #fecaca',
                    whiteSpace: 'pre-wrap',
                  }}
                >
                  {String(selectedDep.meta.errorMessage)}
                </div>
              </div>
            )}
            {selectedDep.meta && selectedDep.meta.error && !selectedDep.meta.errorMessage && (
              <div style={{ fontSize: 11, marginTop: 6 }}>
                <div style={{ fontWeight: 600, color: '#dc2626' }}>Error</div>
                <pre
                  style={{
                    fontSize: 11,
                    background: '#f1f5f9',
                    padding: 6,
                    borderRadius: 4,
                    maxHeight: 180,
                    overflow: 'auto',
                  }}
                >
                  {JSON.stringify(selectedDep.meta.error, null, 2)}
                </pre>
              </div>
            )}
            {selectedDep.meta && !selectedDep.meta.checkDetails && (
              <div style={{ fontSize: 11, marginTop: 6 }}>
                <div style={{ fontWeight: 600 }}>Meta</div>
                <pre
                  style={{
                    fontSize: 11,
                    background: '#f1f5f9',
                    padding: 6,
                    borderRadius: 4,
                    maxHeight: 200,
                    overflow: 'auto',
                  }}
                >
                  {JSON.stringify(selectedDep.meta, null, 2)}
                </pre>
              </div>
            )}
          </div>
        )}
        <div
          style={{
            marginTop: 12,
            background: '#fff',
            padding: 8,
            border: '1px solid #e2e8f0',
            borderRadius: 4,
          }}
        >
          <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Manual Mapping</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label
              style={{
                display: 'flex',
                flexDirection: 'column',
                fontSize: 10,
                textTransform: 'uppercase',
                gap: 2,
              }}
            >
              API Key
              <input
                value={apiKeyInput}
                onChange={(e) => setApiKeyInput(e.target.value)}
                style={inputStyle}
              />
            </label>
            <label
              style={{
                display: 'flex',
                flexDirection: 'column',
                fontSize: 10,
                textTransform: 'uppercase',
                gap: 2,
              }}
            >
              Dependency Name
              <input
                value={selectedDepName}
                onChange={(e) => setSelectedDepName(e.target.value)}
                placeholder="external-service"
                style={inputStyle}
              />
            </label>
            <label
              style={{
                display: 'flex',
                flexDirection: 'column',
                fontSize: 10,
                textTransform: 'uppercase',
                gap: 2,
              }}
            >
              Map To Service
              <select
                value={mapToServiceId}
                onChange={(e) => setMapToServiceId(e.target.value)}
                style={{ ...inputStyle, padding: '4px 6px' }}
              >
                <option value="">-- select service --</option>
                {allServices
                  .filter((s) => s.id !== serviceId)
                  .map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} ({s.environment})
                    </option>
                  ))}
              </select>
            </label>
            <div>
              <button
                disabled={upsertMut.isPending}
                onClick={() => upsertMut.mutate()}
                style={buttonStyle}
              >
                {upsertMut.isPending ? 'Saving...' : 'Save Mapping'}
              </button>
              {upsertMut.isError && <span style={{ color: '#dc2626', marginLeft: 6 }}>Err</span>}
              {upsertMut.isSuccess && (
                <span style={{ color: '#16a34a', marginLeft: 6 }}>Saved</span>
              )}
            </div>
            <div style={{ fontSize: 11, color: '#475569' }}>Overrides:</div>
            {overridesQ.data && overridesQ.data.length === 0 && (
              <div style={{ fontSize: 11 }}>None</div>
            )}
            {overridesQ.data && overridesQ.data.length > 0 && (
              <ul
                style={{
                  listStyle: 'none',
                  padding: 0,
                  margin: 0,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 4,
                }}
              >
                {overridesQ.data.map((o) => (
                  <li
                    key={o.dependencyName}
                    style={{
                      background: '#f1f5f9',
                      padding: '4px 6px',
                      borderRadius: 4,
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                    }}
                  >
                    <span>
                      <code>{o.dependencyName}</code> → <strong>{o.mappedServiceName}</strong>
                    </span>
                    <button
                      onClick={() => deleteMut.mutate(o.dependencyName)}
                      style={{
                        background: 'transparent',
                        border: 'none',
                        color: '#dc2626',
                        cursor: 'pointer',
                        fontSize: 12,
                      }}
                    >
                      ✕
                    </button>
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
import * as d3dag from 'd3-dag';

interface GraphData {
  nodes: Array<{
    id: string;
    name: string;
    status: string;
    hasDeps?: boolean;
    environment?: string | null;
    external?: boolean;
    depth?: number;
  }>;
  edges: Array<{ from: string; to: string; name: string; status: string; latencyMs?: number }>;
}

function GraphVis({
  data,
  selectedId,
  onSelectService,
}: {
  data: GraphData;
  selectedId?: string;
  onSelectService: (id: string) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [dims, setDims] = useState({ w: 1000, h: 700 });
  // Layout persistence
  const LAYOUT_KEY = 'clearDepsGraphLayout_v1';
  const layoutRef = useRef<Record<string, { x: number; y: number }>>({});
  // interaction refs
  const transformRef = useRef({ scale: 1, tx: 0, ty: 0 });
  const nodesRef = useRef<any[]>([]);
  const linksRef = useRef<any[]>([]); // draw links (provider -> consumer)
  const logicalLinksRef = useRef<any[]>([]); // logical dependency links (consumer -> provider)
  const edgeGeomRef = useRef<Array<{ link: any; x1: number; y1: number; x2: number; y2: number }>>(
    []
  );
  const simRef = useRef<any>(null);
  const drawRef = useRef<() => void>();
  const dragRef = useRef<{
    node?: any;
    mode?: 'pan' | 'node';
    startX: number;
    startY: number;
    origTx: number;
    origTy: number;
    moved: boolean;
  }>({ startX: 0, startY: 0, origTx: 0, origTy: 0, moved: false });
  // selected node ref so tick handler always sees current selection
  const selectedIdRef = useRef<string | undefined>(selectedId);
  const selectedEdgeRef = useRef<any | null>(null);
  // live data ref for status/color updates without tearing down simulation
  const dataRef = useRef<GraphData>(data);
  useEffect(() => {
    dataRef.current = data;
  }, [data]);
  useEffect(() => {
    selectedIdRef.current = selectedId;
    if (selectedId) {
      selectedEdgeRef.current = null;
    } // clear edge selection when node explicitly chosen
  // trigger a redraw
  if (drawRef.current) requestAnimationFrame(drawRef.current);
  }, [selectedId]);
  useEffect(() => {
    function handle() {
      setDims({
        w: Math.min(window.innerWidth - 48, 1400),
        h: Math.min(window.innerHeight - 220, 900),
      });
    }
    handle();
    window.addEventListener('resize', handle);
    return () => window.removeEventListener('resize', handle);
  }, []);
  useEffect(() => {
    if (!canvasRef.current) return;
    const ctx = canvasRef.current.getContext('2d');
    if (!ctx) return;
    // prepare font for measuring
    const measureCtx = ctx;
    const BASE_FONT_PX = 12;
    const LINE_HEIGHT = 14; // px in world units
    const PAD_X = 12;
    const PAD_Y = 10;
    const MIN_W = 96;
    const MAX_W = 200;
    const MAX_LINES = 3;
    measureCtx.font = `${BASE_FONT_PX}px system-ui`;
    // Wrap + measure cache
    const measureCache = new Map<string, { w: number; h: number; lines: string[] }>();
    function wrapText(text: string, maxLineWidth: number): { lines: string[]; width: number } {
      const words = (text || '').split(/\s+/).filter(Boolean);
      if (words.length === 0) return { lines: [''], width: 0 };
      const lines: string[] = [];
      let current = '';
      let maxW = 0;
      for (const word of words) {
        const test = current ? current + ' ' + word : word;
        const w = measureCtx.measureText(test).width;
        if (w <= maxLineWidth || !current) {
          current = test;
          if (w > maxW) maxW = w;
        } else {
          lines.push(current);
          current = word;
          maxW = Math.max(maxW, measureCtx.measureText(current).width);
        }
        if (lines.length >= MAX_LINES) break;
      }
      if (lines.length < MAX_LINES && current) {
        lines.push(current);
        maxW = Math.max(maxW, measureCtx.measureText(current).width);
      }
      // Ellipsis if too many words
      if (lines.length > MAX_LINES) {
        lines.length = MAX_LINES;
      }
      if (words.length && lines.length === MAX_LINES) {
        // If there are leftover words, add ellipsis to last line conservatively
        const last = lines[lines.length - 1];
        let withEllipsis = last + '…';
        while (measureCtx.measureText(withEllipsis).width > maxLineWidth && withEllipsis.length > 1) {
          withEllipsis = withEllipsis.slice(0, -2) + '…';
        }
        lines[lines.length - 1] = withEllipsis;
        maxW = Math.max(maxW, measureCtx.measureText(withEllipsis).width);
      }
      return { lines, width: maxW };
    }
    // Load stored layout once (per component lifetime)
    if (Object.keys(layoutRef.current).length === 0) {
      try {
        const raw = localStorage.getItem(LAYOUT_KEY);
        if (raw) layoutRef.current = JSON.parse(raw);
      } catch {
        /* ignore */
      }
    }
  // Build DAG from edges (edges are from consumer -> provider in data; we want arrows provider -> consumer visually)
    const idToChildren = new Map<string, Set<string>>();
    for (const n of data.nodes) {
      idToChildren.set(n.id, new Set());
    }
    for (const e of data.edges) {
      // edge is from consumer to provider; invert to show flow provider -> consumer
      const provider = e.to;
      const consumer = e.from;
      if (!idToChildren.has(provider)) idToChildren.set(provider, new Set());
      idToChildren.get(provider)!.add(consumer);
    }
    // Convert to stratify input: one entry per node with parentIds listing all providers
    const parentsMap = new Map<string, Set<string>>();
    for (const n of data.nodes) parentsMap.set(n.id, new Set());
    for (const [provider, children] of idToChildren.entries()) {
      for (const consumer of children) {
        parentsMap.get(consumer)!.add(provider);
      }
    }
    const dagInput: Array<{ id: string; parentIds: string[] }> = Array.from(parentsMap, ([id, parents]) => ({
      id,
      parentIds: Array.from(parents),
    }));
  const dag = d3dag.graphStratify()(dagInput);
    // Use grid layout for a clean topological look
    // Pre-compute node sizes with wrapping
    for (const n of data.nodes) {
      const content = wrapText(n.name, MAX_W - PAD_X * 2);
      const w = Math.min(Math.max(MIN_W, content.width + PAD_X * 2), MAX_W);
      const h = content.lines.length * LINE_HEIGHT + PAD_Y * 2;
      measureCache.set(n.id, { w, h, lines: content.lines });
    }
    const layout = d3dag
      .grid()
      .nodeSize((n: any) => {
        const dims = measureCache.get(n.data.id)!;
        return [dims.w, dims.h];
      })
      .gap([72, 60]);
    const layoutResult = layout(dag);
    // Map positions from dag after layout
    const nodes: any[] = [];
    for (const n of dag.nodes()) {
      const meta = data.nodes.find((x) => x.id === (n as any).data.id)!;
      const x = (n as any).x as number;
      const y = (n as any).y as number;
  const dims = measureCache.get(meta.id)!;
  const w = dims.w;
  const h = dims.h;
      let nx = x,
        ny = y,
        fx = x,
        fy = y;
      const stored = layoutRef.current[meta.id];
      if (stored) {
        nx = stored.x;
        ny = stored.y;
        fx = stored.x;
        fy = stored.y;
      }
  nodes.push({ ...meta, x: nx, y: ny, fx, fy, _w: w, _h: h, _label: meta.name, _lines: measureCache.get(meta.id)!.lines });
    }
    const nodeById = new Map(nodes.map((n) => [n.id, n] as const));
    const links: any[] = [];
    for (const l of dag.links()) {
      const srcId = (l as any).source.data.id;
      const tgtId = (l as any).target.data.id;
      // Our semantic edge data lives on consumer->provider, but our draw arrow will use provider->consumer
      const back = data.edges.find((e) => e.from === tgtId && e.to === srcId);
      links.push({
        source: nodeById.get(srcId)!,
        target: nodeById.get(tgtId)!,
        name: back?.name ?? '',
        status: back?.status ?? 'OK',
        latencyMs: back?.latencyMs,
      });
    }
    // Logical edges for traversal highlighting (consumer -> provider)
    const logicalLinks: any[] = data.edges.map((e) => ({
      source: nodeById.get(e.from)!,
      target: nodeById.get(e.to)!,
      name: e.name,
      status: e.status,
      latencyMs: e.latencyMs,
    }));
    nodesRef.current = nodes;
    linksRef.current = links;
    logicalLinksRef.current = logicalLinks;
    // No force sim; create a stub with a draw trigger
    if (simRef.current && typeof simRef.current.stop === 'function') {
      try { simRef.current.stop(); } catch {}
    }
    simRef.current = { alpha: () => 0, alphaMin: () => 0, alphaTarget: () => {}, restart: () => {} };
    function statusColor(status: string) {
      return status === 'OK'
        ? '#16a34a'
        : status === 'WARN'
          ? '#f59e0b'
          : status === 'ERROR'
            ? '#dc2626'
            : '#64748b';
    }
  function boundaryDistance(node: any, ux: number, uy: number) {
      // distance from center to boundary along direction (ux,uy)
      if (node.external) {
        return 20; // external circle radius
      }
      const halfW = node._w ? node._w / 2 : 36;
      const halfH = node._h ? node._h / 2 : 22;
      const tx = halfW / (Math.abs(ux) || 1e-6);
      const ty = halfH / (Math.abs(uy) || 1e-6);
      return Math.min(tx, ty);
    }
    function drawArrow(from: any, to: any, color: string) {
      if (!ctx) return { mx: from.x, my: from.y };
      const dx = to.x - from.x;
      const dy = to.y - from.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      const ux = dx / dist;
      const uy = dy / dist;
      const startPad = boundaryDistance(from, ux, uy);
      const endPad = boundaryDistance(to, -ux, -uy) + 6; // gap + arrowhead space
      const startX = from.x + ux * startPad;
      const startY = from.y + uy * startPad;
      const endX = to.x - ux * endPad;
      const endY = to.y - uy * endPad;
      // respect caller's lineWidth & globalAlpha; only set strokeStyle
      ctx.strokeStyle = color;
      ctx.beginPath();
      ctx.moveTo(startX, startY);
      ctx.lineTo(endX, endY);
      ctx.stroke();
      // arrowhead (also respect alpha already set)
      const ahLen = 10;
      const ahW = 6;
      const baseX = endX - ux * ahLen;
      const baseY = endY - uy * ahLen;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(endX, endY);
      ctx.lineTo(baseX + -uy * ahW, baseY + ux * ahW);
      ctx.lineTo(baseX + uy * ahW, baseY + -ux * ahW);
      ctx.closePath();
      ctx.fill();
      // perpendicular normal (for label offset)
      const nx = -uy;
      const ny = ux;
      return { mx: (startX + endX) / 2, my: (startY + endY) / 2, nx, ny };
    }
    // Unified draw function reused by simulation ticks & interaction events
    function draw() {
      if (!ctx) return;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, dims.w, dims.h);
      const { scale, tx, ty } = transformRef.current;
      ctx.setTransform(scale, 0, 0, scale, tx, ty);
      const latest = dataRef.current;
      if (latest) {
        const statusMap = new Map<string, string>();
        for (const n of latest.nodes) statusMap.set(n.id, n.status);
        for (const n of nodes) if (statusMap.has(n.id)) n.status = statusMap.get(n.id)!;
        // update edge statuses/latency based on latest server edges (consumer->provider)
        const edgeStatus = new Map<string, string>();
        const edgeLatency = new Map<string, number | undefined>();
        for (const e of latest.edges) {
          edgeStatus.set(`${e.to}|${e.from}`, e.status);
          edgeLatency.set(`${e.to}|${e.from}`, e.latencyMs);
        }
        for (const l of links) {
          const sId = l.source.id;
          const tId = l.target.id;
          const key = `${sId}|${tId}`; // provider -> consumer
          if (edgeStatus.has(key)) l.status = edgeStatus.get(key)!;
          if (edgeLatency.has(key)) l.latencyMs = edgeLatency.get(key);
        }
      }
      // highlight calculation
      let highlightEdgeKeySet: Set<string> | null = null; // keys as `${src}|${tgt}` for draw links
      let highlightNodeSet: Set<string> | null = null;
      const selEdge = selectedEdgeRef.current;
      if (selEdge) {
        // draw edge is provider -> consumer
        const providerId = selEdge.source && selEdge.source.id ? selEdge.source.id : selEdge.source;
        const consumerId = selEdge.target && selEdge.target.id ? selEdge.target.id : selEdge.target;
        const queue: string[] = [providerId];
        const visited = new Set<string>([providerId]);
        const edgeKeys = new Set<string>();
        edgeKeys.add(`${providerId}|${consumerId}`);
        const nodesUp = new Set<string>([providerId, consumerId]);
        let guard = 0;
        const logical = logicalLinksRef.current;
        while (queue.length && guard < logical.length * 10) {
          guard++;
          const current = queue.shift()!;
          for (const l of logical) {
            const sId = l.source && l.source.id ? l.source.id : l.source; // consumer
            const tId = l.target && l.target.id ? l.target.id : l.target; // provider
            if (sId === current) { // move upstream to provider
              if (!visited.has(tId)) {
                visited.add(tId);
                queue.push(tId);
              }
              // draw orientation is provider -> consumer
              edgeKeys.add(`${tId}|${sId}`);
              nodesUp.add(tId);
              nodesUp.add(sId);
            }
          }
        }
        highlightEdgeKeySet = edgeKeys;
        highlightNodeSet = nodesUp;
      } else {
        const selId = selectedIdRef.current;
        if (selId) {
          const queue: string[] = [selId];
          const visited = new Set<string>([selId]);
          const edgeKeys = new Set<string>();
          const nodesUp = new Set<string>([selId]);
          let guard = 0;
          const logical = logicalLinksRef.current;
          while (queue.length && guard < logical.length * 10) {
            guard++;
            const current = queue.shift()!;
            for (const l of logical) {
              const sId = l.source && l.source.id ? l.source.id : l.source; // consumer
              const tId = l.target && l.target.id ? l.target.id : l.target; // provider
              if (sId === current) {
                if (!visited.has(tId)) {
                  visited.add(tId);
                  queue.push(tId);
                }
                edgeKeys.add(`${tId}|${sId}`);
                nodesUp.add(tId);
              }
            }
          }
          highlightEdgeKeySet = edgeKeys;
          highlightNodeSet = nodesUp;
        }
      }
      edgeGeomRef.current = [];
      for (const l of links) {
        const from: any = l.source; // provider
        const to: any = l.target;   // consumer
        const color = statusColor(l.status);
        const sId = from && from.id ? from.id : from;
        const tId = to && to.id ? to.id : to;
        const highlighted = highlightEdgeKeySet ? highlightEdgeKeySet.has(`${sId}|${tId}`) : false;
        const prevLineWidth = ctx.lineWidth;
        const prevAlpha = ctx.globalAlpha;
        if (!highlighted && highlightEdgeKeySet) {
          ctx.globalAlpha = 0.15;
          ctx.lineWidth = 2;
        } else if (highlighted) {
          ctx.globalAlpha = 1;
          ctx.lineWidth = 4;
        } else {
          ctx.globalAlpha = 0.55;
          ctx.lineWidth = 2;
        }
        // Rounded elbow path via midY
        const midY = (from.y + to.y) / 2;
        const pts = [
          { x: from.x, y: from.y },
          { x: from.x, y: midY },
          { x: to.x, y: midY },
          { x: to.x, y: to.y },
        ];
        ctx.strokeStyle = color;
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        const rcorner = 10;
        for (let i = 1; i < pts.length - 1; i++) {
          const p0 = pts[i - 1], p1 = pts[i], p2 = pts[i + 1];
          const v1x = p1.x - p0.x, v1y = p1.y - p0.y;
          const v2x = p2.x - p1.x, v2y = p2.y - p1.y;
          const len1 = Math.max(1, Math.hypot(v1x, v1y));
          const len2 = Math.max(1, Math.hypot(v2x, v2y));
          const ux1 = v1x / len1, uy1 = v1y / len1;
          const ux2 = v2x / len2, uy2 = v2y / len2;
          const p1a = { x: p1.x - ux1 * rcorner, y: p1.y - uy1 * rcorner };
          const p1b = { x: p1.x + ux2 * rcorner, y: p1.y + uy2 * rcorner };
          ctx.lineTo(p1a.x, p1a.y);
          ctx.quadraticCurveTo(p1.x, p1.y, p1b.x, p1b.y);
        }
        ctx.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y);
        ctx.stroke();
        // Arrowhead based on last segment
        const a = pts[pts.length - 2];
        const b = pts[pts.length - 1];
        const dx = b.x - a.x, dy = b.y - a.y;
        const dlen = Math.max(1, Math.hypot(dx, dy));
        const ux = dx / dlen, uy = dy / dlen;
        const endX = b.x, endY = b.y;
        const ahLen = 10, ahW = 6;
        const baseX = endX - ux * ahLen, baseY = endY - uy * ahLen;
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.moveTo(endX, endY);
        ctx.lineTo(baseX + -uy * ahW, baseY + ux * ahW);
        ctx.lineTo(baseX + uy * ahW, baseY - ux * ahW);
        ctx.closePath();
        ctx.fill();
        // Save a simple bbox for hit test fallback
        edgeGeomRef.current.push({ link: l, x1: from.x, y1: from.y, x2: to.x, y2: to.y });
        ctx.lineWidth = prevLineWidth;
        ctx.globalAlpha = prevAlpha;
        if (
          l.latencyMs !== undefined &&
          l.latencyMs !== null &&
          (!highlightEdgeKeySet || highlighted)
        ) {
          const label = `${l.latencyMs}ms`;
          ctx.save();
          ctx.setTransform(1, 0, 0, 1, 0, 0);
          ctx.font = '10px system-ui';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          const off = 14;
          const nx = -uy;
          const ny = ux;
          const { scale, tx, ty } = transformRef.current;
          const midX = (pts[1].x + pts[2].x) / 2;
          const midY = (pts[1].y + pts[2].y) / 2;
          const sx = midX * scale + tx;
          const sy = midY * scale + ty;
          const lx = sx + nx * off;
          const ly = sy + ny * off;
          const metrics = ctx.measureText(label);
          const padX = 4;
          const padY = 2;
          const textW = metrics.width;
          const textH = 10;
          ctx.fillStyle = 'rgba(255,255,255,0.85)';
          ctx.strokeStyle = color;
          ctx.lineWidth = 0.5;
          const rx = lx - textW / 2 - padX;
          const ry = ly - textH / 2 - padY;
          const rw = textW + padX * 2;
          const rh = textH + padY * 2;
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
          ctx.fillStyle = '#0f172a';
          ctx.fillText(label, lx, ly + 1);
          ctx.restore();
        }
      }
      for (const n of nodes) {
        const inHighlight = highlightNodeSet ? highlightNodeSet.has(n.id) : false;
        const strokeW = inHighlight ? 4 : 3;
        ctx.lineWidth = strokeW;
        ctx.strokeStyle = n.status === 'OK' && n.hasDeps ? '#000000' : statusColor(n.status);
        ctx.fillStyle = inHighlight ? '#f0f9ff' : '#ffffff';
        if (n.external) {
          ctx.beginPath();
          const r = 20;
          ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        } else {
          const halfW = n._w ? n._w / 2 : 36;
          const halfH = n._h ? n._h / 2 : 22;
          // rounded rect
          const x0 = n.x - halfW, y0 = n.y - halfH, w = halfW * 2, h = halfH * 2, r = 8;
          ctx.beginPath();
          ctx.moveTo(x0 + r, y0);
          ctx.lineTo(x0 + w - r, y0);
          ctx.quadraticCurveTo(x0 + w, y0, x0 + w, y0 + r);
          ctx.lineTo(x0 + w, y0 + h - r);
          ctx.quadraticCurveTo(x0 + w, y0 + h, x0 + w - r, y0 + h);
          ctx.lineTo(x0 + r, y0 + h);
          ctx.quadraticCurveTo(x0, y0 + h, x0, y0 + h - r);
          ctx.lineTo(x0, y0 + r);
          ctx.quadraticCurveTo(x0, y0, x0 + r, y0);
          ctx.fill();
          ctx.stroke();
        }
        // Labels: draw under current transform so text scales with zoom
        ctx.font = `${BASE_FONT_PX}px system-ui`;
        ctx.fillStyle = '#0f172a';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const lines: string[] = n._lines || [n._label || n.name];
        const totalH = lines.length * LINE_HEIGHT;
        let y = n.y - totalH / 2 + LINE_HEIGHT / 2;
        for (const line of lines) {
          ctx.fillText(line, n.x, y);
          y += LINE_HEIGHT;
        }
      }
    }
  // initial draw
    draw();
  drawRef.current = draw;
  (simRef.current as any)._drawCustom = draw;
    return () => {
      // nothing
    };
  }, [data, dims.w, dims.h]);
  // capture clicks
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    function toWorld(x: number, y: number) {
      const { scale, tx, ty } = transformRef.current;
      return { wx: (x - tx) / scale, wy: (y - ty) / scale };
    }
    function hitNode(wx: number, wy: number) {
      // iterate in reverse for top-most
      for (let i = nodesRef.current.length - 1; i >= 0; i--) {
        const n = nodesRef.current[i];
        const r = n.external ? 18 : 28;
        const dx = wx - n.x;
        const dy = wy - n.y;
        if (dx * dx + dy * dy <= r * r) return n;
      }
      return undefined;
    }
    function hitEdge(x: number, y: number): any | null {
      const maxDist = 8;
      let closest: { link: any; dist: number } | null = null;
      for (const l of linksRef.current) {
        const from: any = l.source;
        const to: any = l.target;
        const midY = (from.y + to.y) / 2;
        const pts = [
          { x: from.x, y: from.y },
          { x: from.x, y: midY },
          { x: to.x, y: midY },
          { x: to.x, y: to.y },
        ];
        for (let i = 0; i < pts.length - 1; i++) {
          const { x: x1, y: y1 } = pts[i];
          const { x: x2, y: y2 } = pts[i + 1];
          const dx = x2 - x1;
          const dy = y2 - y1;
          const len2 = dx * dx + dy * dy || 1;
          let t = ((x - x1) * dx + (y - y1) * dy) / len2;
          if (t < 0) t = 0;
          else if (t > 1) t = 1;
          const px = x1 + dx * t;
          const py = y1 + dy * t;
          const dist = Math.hypot(x - px, y - py);
          if (dist <= maxDist && (!closest || dist < closest.dist)) closest = { link: l, dist };
        }
      }
      return closest?.link || null;
    }
    function customDraw() {
      const fn = drawRef.current;
      if (fn) requestAnimationFrame(fn);
    }
    function onWheel(ev: WheelEvent) {
      ev.preventDefault();
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const x = ev.clientX - rect.left;
      const y = ev.clientY - rect.top;
      const { scale, tx, ty } = transformRef.current;
      const world = toWorld(x, y);
      const delta = -ev.deltaY * 0.001; // smooth
      let newScale = scale * (1 + delta);
      newScale = Math.min(3, Math.max(0.3, newScale));
      transformRef.current.scale = newScale;
      // keep cursor position stable
      transformRef.current.tx = x - world.wx * newScale;
      transformRef.current.ty = y - world.wy * newScale;
      customDraw();
    }
    function onDown(ev: MouseEvent) {
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const x = ev.clientX - rect.left;
      const y = ev.clientY - rect.top;
      const { wx, wy } = toWorld(x, y);
      const node = hitNode(wx, wy);
      dragRef.current.node = node;
      dragRef.current.mode = node ? 'node' : 'pan';
      dragRef.current.startX = x;
      dragRef.current.startY = y;
      dragRef.current.origTx = transformRef.current.tx;
      dragRef.current.origTy = transformRef.current.ty;
      dragRef.current.moved = false;
      if (node) {
        // start dragging
        node.fx = node.x;
        node.fy = node.y;
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
      const x = ev.clientX - rect.left;
      const y = ev.clientY - rect.top;
      if (dragRef.current.mode === 'node' && dragRef.current.node) {
        dragRef.current.moved = true;
        const { wx, wy } = toWorld(x, y);
        dragRef.current.node.fx = wx;
        dragRef.current.node.fy = wy;
        dragRef.current.node.x = wx;
        dragRef.current.node.y = wy;
        customDraw();
      } else if (dragRef.current.mode === 'pan') {
        const dx = x - dragRef.current.startX;
        const dy = y - dragRef.current.startY;
        if (Math.abs(dx) > 2 || Math.abs(dy) > 2) dragRef.current.moved = true;
        transformRef.current.tx = dragRef.current.origTx + dx;
        transformRef.current.ty = dragRef.current.origTy + dy;
        customDraw();
      } else {
        // hover state
        const { wx, wy } = toWorld(x, y);
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
        if (canvas) canvas.style.cursor = 'grab';
        if (canvas) canvas.style.cursor = 'grab';
        if (!dragRef.current.moved) {
          onSelectService(node.id);
        }
      } else if (!dragRef.current.moved) {
        // Edge click detection when not dragging a node
        if (canvas) {
          const rect = canvas.getBoundingClientRect();
          const cx = ev.clientX - rect.left;
          const cy = ev.clientY - rect.top;
          const { wx, wy } = toWorld(cx, cy);
          const edge = hitEdge(wx, wy);
          if (edge) {
            selectedEdgeRef.current = edge; // select edge
            selectedIdRef.current = undefined; // clear node selection
    customDraw();
          } else {
            // background click clears edge selection only
            if (selectedEdgeRef.current) {
              selectedEdgeRef.current = null;
      customDraw();
            }
          }
        }
      }
      // Persist layout if a node was actually moved
      if (wasNode && dragRef.current.moved && node) {
        try {
          // Update internal node fixed positions and save all
          node.fx = node.x;
          node.fy = node.y;
          const snapshot: Record<string, { x: number; y: number }> = {};
          for (const n of nodesRef.current) {
            if (!n.external && typeof n.x === 'number' && typeof n.y === 'number') {
              snapshot[n.id] = { x: n.x, y: n.y };
            }
          }
          layoutRef.current = snapshot;
          localStorage.setItem(LAYOUT_KEY, JSON.stringify(snapshot));
        } catch {
          /* ignore */
        }
      }
      dragRef.current.mode = undefined;
      dragRef.current.node = undefined;
      dragRef.current.moved = false;
      if (canvas) canvas.style.cursor = 'default';
      if (canvas) canvas.style.cursor = 'default';
      customDraw();
    }
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('mousedown', onDown);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('mousedown', onDown);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [onSelectService]);
  return (
    <canvas
      ref={canvasRef}
      width={dims.w}
      height={dims.h}
      style={{
        maxWidth: '100%',
        border: '1px solid #e2e8f0',
        background: '#ffffff',
        borderRadius: 4,
      }}
    />
  );
}
