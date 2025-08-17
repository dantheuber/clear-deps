import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { listServices, getGraph } from '../api';

export function App() {
  const servicesQ = useQuery({ queryKey: ['services'], queryFn: listServices, refetchInterval: 10000 });
  const graphQ = useQuery({ queryKey: ['graph'], queryFn: getGraph, refetchInterval: 15000 });
  return (
    <div style={{ fontFamily: 'system-ui', padding: 16 }}>
      <h1>clear-deps</h1>
      <section>
        <h2>Services</h2>
        {servicesQ.isLoading && <p>Loading...</p>}
        {servicesQ.error && <p>Error loading services</p>}
        <table style={{ borderCollapse: 'collapse', minWidth: 600 }}>
          <thead>
            <tr><th align="left">Name</th><th>Env</th><th>Status</th><th>Endpoint</th></tr>
          </thead>
          <tbody>
            {servicesQ.data?.map(s => (
              <tr key={s.id} style={{ borderBottom: '1px solid #ddd' }}>
                <td>{s.name}</td>
                <td>{s.environment}</td>
                <td><StatusPill status={s.overallStatus} /></td>
                <td><code>{s.endpointUrl}</code></td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
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
