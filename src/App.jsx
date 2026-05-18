import { useState, useEffect, useCallback } from 'react';

// ─── Constants ────────────────────────────────────────────────────────────────

const TOKEN_KEY = 'hd_dash_token';

const FILTERS = [
  { key: 'all',           label: 'All',           cls: '' },
  { key: 'urgent',        label: '🚨 Urgent',      cls: 'active-urgent' },
  { key: 'routine',       label: 'Routine',        cls: '' },
  { key: 'not_contacted', label: 'Not Contacted',  cls: '' },
  { key: 'contacted',     label: 'Contacted',      cls: '' },
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

function exportCSV(entries) {
  const cols = ['patient_name','phone','service_needed','preferred_days','preferred_times','priority','contacted','created_at','notes'];
  const header = cols.join(',');
  const rows = entries.map(e =>
    cols.map(c => JSON.stringify(e[c] ?? '')).join(',')
  );
  const csv = [header, ...rows].join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `hammond-dental-waitlist-${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ─── Login ───────────────────────────────────────────────────────────────────

function Login({ onLogin }) {
  const [pw,  setPw]  = useState('');
  const [err, setErr] = useState('');
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
      onLogin(data.token);
    } catch (e) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-wrap">
      <div className="login-card">
        <div className="logo">🦷</div>
        <h1>Hammond Dental</h1>
        <p>Admin Dashboard</p>
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

// ─── Stats Bar ───────────────────────────────────────────────────────────────

function StatsBar({ stats }) {
  return (
    <div className="stats-row">
      <div className="stat-card accent">
        <div className="label">This Month</div>
        <div className="value">{stats.totalThisMonth}</div>
      </div>
      <div className="stat-card urgent">
        <div className="label">Urgent Pending</div>
        <div className="value">{stats.urgentPending}</div>
      </div>
      <div className="stat-card success">
        <div className="label">Total Shown</div>
        <div className="value">{stats.totalShown}</div>
      </div>
    </div>
  );
}

// ─── Waitlist Table ──────────────────────────────────────────────────────────

function WaitlistTable({ entries, onToggleContacted, updating }) {
  if (entries.length === 0) {
    return (
      <div className="table-wrap">
        <div className="empty-state">
          <div className="icon">📋</div>
          <p>No entries match this filter.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Patient</th>
            <th>Phone</th>
            <th>Service</th>
            <th>Preference</th>
            <th>Added</th>
            <th>Priority</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          {entries.map(e => (
            <tr key={e.id} className={e.contacted ? 'is-contacted' : ''}>
              <td className="td-name">{e.patient_name}</td>
              <td className="td-phone">
                <a href={`tel:${e.phone}`}>{e.phone}</a>
              </td>
              <td className="td-service">{e.service_needed}</td>
              <td className="td-pref">
                {[e.preferred_days, e.preferred_times].filter(Boolean).join(' / ') || '—'}
              </td>
              <td className="td-date">{fmtDate(e.created_at)}</td>
              <td>
                <span className={`badge badge-${e.priority}`}>{e.priority}</span>
              </td>
              <td>
                {e.contacted ? (
                  <button
                    className="btn-contact btn-contact-undo"
                    disabled={updating.has(e.id)}
                    onClick={() => onToggleContacted(e.id, false)}
                  >
                    Undo
                  </button>
                ) : (
                  <button
                    className="btn-contact btn-contact-mark"
                    disabled={updating.has(e.id)}
                    onClick={() => onToggleContacted(e.id, true)}
                  >
                    {updating.has(e.id) ? '…' : '✓ Contacted'}
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Dashboard ───────────────────────────────────────────────────────────────

function Dashboard({ token, onLogout }) {
  const [entries,  setEntries]  = useState([]);
  const [stats,    setStats]    = useState({ totalThisMonth: 0, urgentPending: 0, totalShown: 0 });
  const [filter,   setFilter]   = useState('all');
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState('');
  const [updating, setUpdating] = useState(new Set());

  const authHeaders = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const r = await fetch('/api/dashboard/waitlist', { headers: authHeaders });
      if (r.status === 401) { onLogout(); return; }
      if (!r.ok) throw new Error('Failed to load data');
      const data = await r.json();
      setEntries(data.entries);
      setStats(data.stats);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { fetchData(); }, [fetchData]);

  async function handleToggleContacted(id, contacted) {
    setUpdating(prev => new Set([...prev, id]));
    try {
      const r = await fetch('/api/dashboard/waitlist', {
        method: 'PATCH',
        headers: authHeaders,
        body: JSON.stringify({ ids: [id], contacted }),
      });
      if (!r.ok) throw new Error('Update failed');
      setEntries(prev =>
        prev.map(e => e.id === id ? { ...e, contacted } : e)
      );
      // Refresh stats
      setStats(prev => ({
        ...prev,
        urgentPending: entries
          .map(e => e.id === id ? { ...e, contacted } : e)
          .filter(e => e.priority === 'urgent' && !e.contacted).length,
      }));
    } catch (e) {
      setError(e.message);
    } finally {
      setUpdating(prev => { const s = new Set(prev); s.delete(id); return s; });
    }
  }

  // Apply client-side filter
  const filtered = entries.filter(e => {
    if (filter === 'urgent')        return e.priority === 'urgent';
    if (filter === 'routine')       return e.priority === 'routine';
    if (filter === 'not_contacted') return !e.contacted;
    if (filter === 'contacted')     return e.contacted;
    return true;
  });

  return (
    <div className="layout">
      <header className="topbar">
        <div className="topbar-left">
          <span className="logo">🦷</span>
          <h1>Hammond Dental</h1>
          <span>Admin Dashboard</span>
        </div>
        <button className="btn-logout" onClick={onLogout}>Sign out</button>
      </header>

      <main className="main">
        {error && <div className="error-banner">⚠️ {error}</div>}

        <StatsBar stats={{ ...stats, totalShown: filtered.length }} />

        <div className="toolbar">
          <div className="filter-group">
            {FILTERS.map(f => (
              <button
                key={f.key}
                className={`btn-filter ${filter === f.key ? (f.cls || 'active') : ''}`}
                onClick={() => setFilter(f.key)}
              >
                {f.label}
              </button>
            ))}
          </div>
          <div className="toolbar-right">
            <button className="btn-secondary" onClick={fetchData}>↻ Refresh</button>
            <button
              className="btn-secondary"
              onClick={() => exportCSV(filtered)}
              disabled={filtered.length === 0}
            >
              ↓ Export CSV
            </button>
          </div>
        </div>

        {loading ? (
          <div className="page-center">
            <div className="spinner" />
            Loading waitlist…
          </div>
        ) : (
          <WaitlistTable
            entries={filtered}
            onToggleContacted={handleToggleContacted}
            updating={updating}
          />
        )}
      </main>
    </div>
  );
}

// ─── App root ─────────────────────────────────────────────────────────────────

export default function App() {
  const [token, setToken] = useState(() => sessionStorage.getItem(TOKEN_KEY));

  function handleLogin(t)  { setToken(t); }
  function handleLogout()  { sessionStorage.removeItem(TOKEN_KEY); setToken(null); }

  if (!token) return <Login onLogin={handleLogin} />;
  return <Dashboard token={token} onLogout={handleLogout} />;
}
