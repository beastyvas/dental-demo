import { useState, useEffect, useCallback } from 'react';

// ─── Constants ────────────────────────────────────────────────────────────────

const TOKEN_KEY = 'hd_dash_token';
const USER_KEY  = 'hd_dash_user';  // JSON: { role, business_name }

const FILTERS = [
  { key: 'all',     label: 'All Active' },
  { key: 'urgent',  label: '🚨 Urgent'  },
  { key: 'routine', label: 'Routine'    },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-US', {
    timeZone: 'America/Los_Angeles',
    month:  'short',
    day:    'numeric',
    hour:   'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

function timeAgo(iso) {
  if (!iso) return null;
  const diff = Date.now() - new Date(iso).getTime();
  const mins  = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days  = Math.floor(diff / 86400000);
  if (mins  <  2) return 'just now';
  if (mins  < 60) return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days  <  7) return `${days}d ago`;
  return fmtDate(iso);
}

function clientHealth(c) {
  if (c.stats?.urgentActive > 0) return { dot: 'health-urgent', label: 'Needs attention' };
  const last = c.stats?.lastActivity;
  if (!last) return { dot: 'health-none', label: 'No activity yet' };
  const days = (Date.now() - new Date(last).getTime()) / 86400000;
  if (days <= 3)  return { dot: 'health-active', label: 'Active' };
  if (days <= 14) return { dot: 'health-idle',   label: 'Quiet' };
  return { dot: 'health-none', label: 'Inactive' };
}

function exportCSV(entries) {
  const cols = ['patient_name','phone','service_needed','preferred_days','preferred_times','priority','created_at','notes','business_name'];
  const header = cols.join(',');
  const rows = entries.map(e =>
    cols.map(c => JSON.stringify(e[c] ?? '')).join(',')
  );
  const csv  = [header, ...rows].join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `leads-${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ─── Login ───────────────────────────────────────────────────────────────────

function Login({ onLogin }) {
  const [pw,      setPw]      = useState('');
  const [err,     setErr]     = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setErr('');
    setLoading(true);
    try {
      const r = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: pw }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'Login failed');
      sessionStorage.setItem(TOKEN_KEY, data.token);
      sessionStorage.setItem(USER_KEY, JSON.stringify({ role: data.role, business_name: data.business_name, demo_phone: data.demo_phone ?? null }));
      onLogin(data.token, { role: data.role, business_name: data.business_name, demo_phone: data.demo_phone ?? null });
    } catch (e) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-wrap">
      <div className="login-card">
        <div className="logo">📞</div>
        <h1>NickBuilds</h1>
        <p>Receptionist Platform</p>
        <form onSubmit={handleSubmit}>
          <input
            type="password"
            placeholder="Enter password"
            value={pw}
            onChange={e => setPw(e.target.value)}
            autoFocus
          />
          <button type="submit" className="btn-primary" disabled={loading || !pw}>
            {loading ? 'Signing in…' : 'Sign In'}
          </button>
        </form>
        {err && <div className="login-error">{err}</div>}
      </div>
    </div>
  );
}

// ─── Welcome Bar ─────────────────────────────────────────────────────────────

function WelcomeBar({ businessName, demoPhone }) {
  const fmtPhone = p => p ? `(${p.slice(0,3)}) ${p.slice(3,6)}-${p.slice(6)}` : null;
  const demo = fmtPhone(demoPhone);

  return (
    <div className="welcome-bar">
      <span>Welcome to <strong>{businessName}</strong>'s Virtual Receptionist Dashboard.</span>
      {demo && <span>📞 Call <strong>{demo}</strong> to hear Ava in action.</span>}
      <span>Questions? Text Nick at <strong>(702) 428-9920</strong></span>
    </div>
  );
}

// ─── Stats Bar ───────────────────────────────────────────────────────────────

function StatsBar({ stats }) {
  return (
    <div className="stats-row">
      <div className="stat-card accent">
        <div className="label">Leads This Month</div>
        <div className="value">{stats.totalThisMonth}</div>
      </div>
      <div className="stat-card urgent">
        <div className="label">Urgent Active</div>
        <div className="value">{stats.urgentPending}</div>
      </div>
      <div className="stat-card success">
        <div className="label">Scheduled This Month</div>
        <div className="value">{stats.scheduledMonth}</div>
      </div>
    </div>
  );
}

// ─── Patient Detail Drawer ───────────────────────────────────────────────────

function DetailDrawer({ entry, onClose, onScheduled, onDelete, updating }) {
  if (!entry) return null;
  const busy = updating.has(entry.id);

  return (
    <>
      <div className="drawer-overlay" onClick={onClose} />
      <div className="drawer">
        <div className="drawer-header">
          <div className="drawer-title">
            <span>{entry.patient_name}</span>
            <span className={`badge badge-${entry.priority}`}>{entry.priority}</span>
          </div>
          <button className="drawer-close" onClick={onClose}>✕</button>
        </div>

        <div className="drawer-body">
          {entry.business_name && (
            <div className="detail-section">
              <div className="detail-label">Office</div>
              <div className="detail-value">{entry.business_name}</div>
            </div>
          )}

          <div className="detail-section">
            <div className="detail-label">Phone</div>
            <a href={`tel:${entry.phone}`} className="btn-call drawer-call">📞 {entry.phone}</a>
          </div>

          <div className="detail-section">
            <div className="detail-label">Service Needed</div>
            <div className="detail-value">{entry.service_needed || '—'}</div>
          </div>

          <div className="detail-row">
            <div className="detail-section">
              <div className="detail-label">Preferred Days</div>
              <div className="detail-value">{entry.preferred_days || '—'}</div>
            </div>
            <div className="detail-section">
              <div className="detail-label">Preferred Times</div>
              <div className="detail-value">{entry.preferred_times || '—'}</div>
            </div>
          </div>

          {entry.notes && (
            <div className="detail-section">
              <div className="detail-label">Patient Notes</div>
              <div className="detail-value detail-notes">{entry.notes}</div>
            </div>
          )}

          <div className="detail-section">
            <div className="detail-label">Called In</div>
            <div className="detail-value detail-muted">{fmtDate(entry.created_at)}</div>
          </div>
        </div>

        <div className="drawer-footer">
          <button
            className="btn-scheduled drawer-btn"
            disabled={busy}
            onClick={() => { onScheduled(entry.id); onClose(); }}
          >
            {busy ? '…' : '✓ Mark as Scheduled'}
          </button>
          <button
            className="btn-delete drawer-btn-delete"
            disabled={busy}
            onClick={() => { onDelete(entry.id); onClose(); }}
          >
            🗑 Delete
          </button>
        </div>
      </div>
    </>
  );
}

// ─── Waitlist Table ──────────────────────────────────────────────────────────

function WaitlistTable({ entries, onScheduled, onDelete, updating, isAdmin }) {
  const [selected, setSelected] = useState(null);

  useEffect(() => {
    if (selected && !entries.find(e => e.id === selected.id)) {
      setSelected(null);
    }
  }, [entries, selected]);

  if (entries.length === 0) {
    return (
      <div className="table-wrap">
        <div className="empty-state">
          <div className="icon">📋</div>
          <p>No active leads. All caught up!</p>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              {isAdmin && <th>Office</th>}
              <th>Patient</th>
              <th>Phone</th>
              <th>Service</th>
              <th>Preference</th>
              <th>Added</th>
              <th>Priority</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {entries.map(e => (
              <tr
                key={e.id}
                className={`row-clickable ${e.priority === 'urgent' ? 'row-urgent' : ''} ${selected?.id === e.id ? 'row-selected' : ''}`}
                onClick={() => setSelected(e)}
              >
                {isAdmin && (
                  <td className="td-office">{e.business_name || '—'}</td>
                )}
                <td className="td-name">{e.patient_name}</td>
                <td className="td-phone" onClick={ev => ev.stopPropagation()}>
                  <a href={`tel:${e.phone}`} className="btn-call">📞 Call</a>
                </td>
                <td className="td-service">{e.service_needed}</td>
                <td className="td-pref">
                  {[e.preferred_days, e.preferred_times].filter(Boolean).join(' / ') || '—'}
                </td>
                <td className="td-date">{fmtDate(e.created_at)}</td>
                <td>
                  <span className={`badge badge-${e.priority}`}>{e.priority}</span>
                </td>
                <td className="td-actions" onClick={ev => ev.stopPropagation()}>
                  <button
                    className="btn-scheduled"
                    disabled={updating.has(e.id)}
                    onClick={() => onScheduled(e.id)}
                    title="Mark as scheduled"
                  >
                    {updating.has(e.id) ? '…' : '✓ Scheduled'}
                  </button>
                  <button
                    className="btn-delete"
                    disabled={updating.has(e.id)}
                    onClick={() => onDelete(e.id)}
                    title="Delete lead permanently"
                  >
                    🗑
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <DetailDrawer
        entry={selected}
        onClose={() => setSelected(null)}
        onScheduled={onScheduled}
        onDelete={onDelete}
        updating={updating}
      />
    </>
  );
}

// ─── Admin Overview ──────────────────────────────────────────────────────────

function AdminOverview({ token, onSelectClient }) {
  const [clients,   setClients]   = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState('');
  const [lastFetch, setLastFetch] = useState(null);

  async function load() {
    setLoading(true);
    setError('');
    try {
      const r = await fetch('/api/dashboard/clients', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!r.ok) throw new Error('Failed to load clients');
      const data = await r.json();
      setClients(data.clients);
      setLastFetch(new Date());
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [token]);

  // Platform-wide totals
  const totalActive  = clients.reduce((s, c) => s + (c.stats?.activeLeads  ?? 0), 0);
  const totalUrgent  = clients.reduce((s, c) => s + (c.stats?.urgentActive ?? 0), 0);
  const totalMonth   = clients.reduce((s, c) => s + (c.stats?.monthLeads   ?? 0), 0);
  const needsAttention = clients.filter(c => (c.stats?.urgentActive ?? 0) > 0);

  if (loading) return <div className="page-center"><div className="spinner" /> Loading platform…</div>;
  if (error)   return <div className="error-banner">⚠️ {error}</div>;

  return (
    <div className="founder-view">

      {/* Header row */}
      <div className="founder-header">
        <div>
          <div className="founder-title">Platform Overview</div>
          <div className="founder-subtitle">
            {clients.length} active client{clients.length !== 1 ? 's' : ''} · receptionist network
            {lastFetch && <span> · updated {timeAgo(lastFetch.toISOString())}</span>}
          </div>
        </div>
        <button className="btn-secondary" onClick={load} disabled={loading}>↻ Refresh</button>
      </div>

      {/* Attention banner */}
      {needsAttention.length > 0 && (
        <div className="attention-banner">
          🚨 <strong>{needsAttention.length} client{needsAttention.length > 1 ? 's' : ''} need attention</strong>
          {' — '}
          {needsAttention.map(c => c.business_name).join(', ')} has urgent unscheduled leads
        </div>
      )}

      {/* Platform stats */}
      <div className="stats-row" style={{ marginBottom: 28 }}>
        <div className="stat-card accent">
          <div className="label">Active Clients</div>
          <div className="value">{clients.length}</div>
        </div>
        <div className="stat-card">
          <div className="label">Active Leads</div>
          <div className="value">{totalActive}</div>
        </div>
        <div className="stat-card urgent">
          <div className="label">Urgent Pending</div>
          <div className="value">{totalUrgent}</div>
        </div>
        <div className="stat-card success">
          <div className="label">Leads This Month</div>
          <div className="value">{totalMonth}</div>
        </div>
      </div>

      {/* Section label */}
      <div className="section-label">Clients</div>

      {/* Client cards */}
      {clients.length === 0 ? (
        <div className="empty-state">
          <div className="icon">🏢</div>
          <p>No clients yet — add one in Supabase to get started.</p>
        </div>
      ) : (
        <div className="client-grid">
          {clients.map(c => {
            const health = clientHealth(c);
            const ago    = timeAgo(c.stats?.lastActivity);
            return (
              <button key={c.id} className="client-card" onClick={() => onSelectClient(c)}>
                <div className="client-card-header">
                  <div className="client-card-name-row">
                    <span className={`health-dot ${health.dot}`} title={health.label} />
                    <span className="client-card-name">{c.business_name}</span>
                  </div>
                  {c.stats?.urgentActive > 0 && (
                    <span className="badge badge-urgent">{c.stats.urgentActive} urgent</span>
                  )}
                </div>

                <div className="client-card-stats">
                  <div className="client-stat">
                    <div className="client-stat-val">{c.stats?.activeLeads ?? 0}</div>
                    <div className="client-stat-label">Active</div>
                  </div>
                  <div className="client-stat">
                    <div className="client-stat-val">{c.stats?.monthLeads ?? 0}</div>
                    <div className="client-stat-label">This Month</div>
                  </div>
                  <div className="client-stat client-stat-health">
                    <div className={`client-stat-status ${health.dot}`}>{health.label}</div>
                    {ago && <div className="client-stat-label">{ago}</div>}
                  </div>
                </div>

                <div className="client-card-arrow">View leads →</div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Client Leads View (shared by clients + admin drill-in) ──────────────────

function ClientLeadsView({ token, clientId, onBack }) {
  const [entries,  setEntries]  = useState([]);
  const [stats,    setStats]    = useState({ totalThisMonth: 0, urgentPending: 0, scheduledMonth: 0 });
  const [filter,   setFilter]   = useState('all');
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState('');
  const [updating, setUpdating] = useState(new Set());

  const authHeaders = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const url = clientId
        ? `/api/dashboard/waitlist?adminClientId=${clientId}`
        : '/api/dashboard/waitlist';
      const r = await fetch(url, { headers: authHeaders });
      if (!r.ok) throw new Error('Failed to load data');
      const data = await r.json();
      setEntries(data.entries);
      setStats(data.stats);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [token, clientId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  function lockId(id)   { setUpdating(prev => new Set([...prev, id])); }
  function unlockId(id) { setUpdating(prev => { const s = new Set(prev); s.delete(id); return s; }); }

  async function handleScheduled(id) {
    lockId(id);
    try {
      const r = await fetch('/api/dashboard/waitlist', {
        method: 'PATCH', headers: authHeaders,
        body: JSON.stringify({ ids: [id] }),
      });
      if (!r.ok) throw new Error('Update failed');
      setEntries(prev => prev.filter(e => e.id !== id));
      setStats(prev => ({ ...prev, scheduledMonth: prev.scheduledMonth + 1 }));
    } catch (e) { setError(e.message); }
    finally { unlockId(id); }
  }

  async function handleDelete(id) {
    if (!window.confirm('Delete this lead permanently?')) return;
    lockId(id);
    try {
      const r = await fetch('/api/dashboard/waitlist', {
        method: 'DELETE', headers: authHeaders,
        body: JSON.stringify({ ids: [id] }),
      });
      if (!r.ok) throw new Error('Delete failed');
      setEntries(prev => prev.filter(e => e.id !== id));
    } catch (e) { setError(e.message); }
    finally { unlockId(id); }
  }

  const filtered = entries.filter(e => {
    if (filter === 'urgent')  return e.priority === 'urgent';
    if (filter === 'routine') return e.priority === 'routine';
    return true;
  });

  return (
    <main className="main">
      {onBack && (
        <button className="btn-back" onClick={onBack}>← All Clients</button>
      )}
      {error && <div className="error-banner">⚠️ {error}</div>}
      <StatsBar stats={stats} />
      <div className="toolbar">
        <div className="filter-group">
          {FILTERS.map(f => (
            <button key={f.key}
              className={`btn-filter ${filter === f.key ? 'active' : ''}`}
              onClick={() => setFilter(f.key)}
            >{f.label}</button>
          ))}
        </div>
        <div className="toolbar-right">
          <button className="btn-secondary" onClick={fetchData}>↻ Refresh</button>
          <button className="btn-secondary" onClick={() => exportCSV(filtered)} disabled={filtered.length === 0}>↓ Export CSV</button>
        </div>
      </div>
      {loading ? (
        <div className="page-center"><div className="spinner" /> Loading leads…</div>
      ) : (
        <WaitlistTable entries={filtered} onScheduled={handleScheduled} onDelete={handleDelete} updating={updating} />
      )}
    </main>
  );
}

// ─── Dashboard ───────────────────────────────────────────────────────────────

function Dashboard({ token, user, onLogout }) {
  const isAdmin = user?.role === 'admin';
  const [selectedClient, setSelectedClient] = useState(null);

  const headerTitle = selectedClient
    ? selectedClient.business_name
    : isAdmin ? 'NickBuilds' : (user?.business_name || 'Dashboard');

  useEffect(() => {
    if (isAdmin && !selectedClient) document.title = 'NickBuilds — Admin';
    else document.title = `${headerTitle} — Dashboard`;
  }, [headerTitle, isAdmin, selectedClient]);

  return (
    <div className="layout">
      <header className="topbar">
        <div className="topbar-left">
          <span className="logo">📞</span>
          <h1>{headerTitle}</h1>
          {isAdmin && !selectedClient && <span className="badge-admin">ADMIN</span>}
          {!isAdmin && <span>Dashboard</span>}
        </div>
        <button className="btn-logout" onClick={onLogout}>Sign out</button>
      </header>

      {!isAdmin && (
        <WelcomeBar businessName={user?.business_name} demoPhone={user?.demo_phone} />
      )}

      {isAdmin && !selectedClient ? (
        <main className="main">
          <AdminOverview token={token} onSelectClient={setSelectedClient} />
        </main>
      ) : (
        <ClientLeadsView
          token={token}
          clientId={isAdmin ? selectedClient?.id : null}
          onBack={isAdmin ? () => setSelectedClient(null) : null}
        />
      )}
    </div>
  );
}

// ─── App root ─────────────────────────────────────────────────────────────────

export default function App() {
  const [token, setToken] = useState(() => sessionStorage.getItem(TOKEN_KEY));
  const [user,  setUser]  = useState(() => {
    try { return JSON.parse(sessionStorage.getItem(USER_KEY)); } catch { return null; }
  });

  function handleLogin(t, u)  { setToken(t); setUser(u); }
  function handleLogout() {
    sessionStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(USER_KEY);
    setToken(null);
    setUser(null);
  }

  if (!token) return <Login onLogin={handleLogin} />;
  return <Dashboard token={token} user={user} onLogout={handleLogout} />;
}
