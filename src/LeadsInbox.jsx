// Lead inbox — every lead (calls, website form, Angi/Thumbtack/Facebook
// emails, reactivation replies) with how fast we answered, and the buttons
// that move it along: Estimate sent starts the follow-up texts, Booked sets up
// reminders, Job done sends the review request.
import { Fragment, useCallback, useEffect, useState } from 'react';

const SOURCE = {
  call: 'Phone', form: 'Website', email: 'Email', angi: 'Angi', thumbtack: 'Thumbtack', meta: 'Facebook',
  reactivation: 'Reactivation', manual: 'Added', jobber: 'Jobber', hcp: 'Housecall Pro',
};
const STATUS = {
  new: { label: 'New', cls: 'badge-urgent' },
  contacted: { label: 'Contacted', cls: 'badge-lead' },
  replied: { label: 'Replied', cls: 'badge-lead' },
  estimate_sent: { label: 'Estimate sent', cls: 'badge-routine' },
  booked: { label: 'Booked', cls: 'badge-booked' },
  job_done: { label: 'Job done', cls: 'badge-booked' },
  won: { label: 'Won', cls: 'badge-booked' },
  lost: { label: 'Lost', cls: 'badge-muted' },
};

const when = (iso) => (iso ? new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—');

function responseTime(l) {
  if (!l.first_response_at) return null;
  const s = Math.max(0, Math.round((new Date(l.first_response_at) - new Date(l.received_at)) / 1000));
  return s < 60 ? `${s}s` : s < 3600 ? `${Math.round(s / 60)}m` : `${Math.round(s / 3600)}h`;
}

// <input type="datetime-local"> wants local "YYYY-MM-DDTHH:mm".
const toLocalInput = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};

export default function LeadsInbox({ token, clientId }) {
  const [leads, setLeads] = useState([]);
  const [stats, setStats] = useState(null);
  const [open, setOpen] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [setupNeeded, setSetupNeeded] = useState(false);
  const [apptAt, setApptAt] = useState('');

  const url = clientId ? `/api/dashboard/leads?adminClientId=${clientId}` : '/api/dashboard/leads';
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      const data = r.ok ? await r.json() : { leads: [] };
      setLeads(data.leads ?? []);
      setStats(data.stats ?? null);
      setSetupNeeded(!!data.setupNeeded);
    } finally {
      setLoading(false);
    }
  }, [url, token]);

  useEffect(() => { load(); }, [load]);

  const move = async (lead, status, extra = {}) => {
    setBusy(lead.id);
    setError(null);
    setNotice(null);
    try {
      const r = await fetch(url, { method: 'PATCH', headers, body: JSON.stringify({ id: lead.id, status, ...extra }) });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'Could not update');
      setLeads((ls) => ls.map((l) => (l.id === lead.id ? { ...l, ...data.lead } : l)));
      const did = (data.automations ?? []).filter(Boolean);
      if (did.length) setNotice(did.join(' · '));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  };

  if (setupNeeded) return null;

  return (
    <section className="calls-section">
      <div className="calls-header">
        <h2>Leads</h2>
        <button className="btn-secondary" onClick={load} disabled={loading}>↻ Refresh</button>
      </div>

      {stats && (
        <div className="stats-row">
          <div className="stat-card accent">
            <div className="label">Leads this month</div>
            <div className="value">{stats.thisMonth}</div>
          </div>
          <div className="stat-card success">
            <div className="label">Typical response</div>
            <div className="value">
              {stats.medianResponseSeconds == null ? '—'
                : stats.medianResponseSeconds < 60 ? `${Math.round(stats.medianResponseSeconds)}s`
                : `${Math.round(stats.medianResponseSeconds / 60)}m`}
            </div>
          </div>
          <div className="stat-card">
            <div className="label">Answered in 5 min</div>
            <div className="value">
              {stats.under5min}<span className="value-sub"> / {stats.outsideLeads}</span>
            </div>
          </div>
        </div>
      )}

      {error && <div className="error-banner">{error}</div>}
      {notice && <div className="notice-banner">{notice}</div>}

      {loading ? (
        <div className="page-center"><div className="spinner" /> Loading leads…</div>
      ) : leads.length === 0 ? (
        <div className="empty-state">No leads yet. Calls, website forms and Angi/Thumbtack emails all land here.</div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>When</th><th>Who</th><th>From</th><th>Status</th><th>Answered in</th></tr>
            </thead>
            <tbody>
              {leads.map((l) => {
                const s = STATUS[l.status] ?? { label: l.status, cls: 'badge-muted' };
                const isOpen = open === l.id;
                return (
                  <Fragment key={l.id}>
                    <tr className="call-row" onClick={() => { setOpen(isOpen ? null : l.id); setApptAt(toLocalInput(l.appointment_at)); }}>
                      <td>{when(l.received_at)}</td>
                      <td>
                        <div>{l.name || 'Unknown'}</div>
                        {l.phone && <a href={`tel:${l.phone}`} onClick={(e) => e.stopPropagation()} className="muted-link">{l.phone}</a>}
                      </td>
                      <td>{SOURCE[l.source] ?? l.source}</td>
                      <td>
                        <span className={`badge ${s.cls}`}>{s.label}</span>
                        {l.appointment_at && <span className="tag-after-hours">{when(l.appointment_at)}</span>}
                      </td>
                      <td>{responseTime(l) ?? '—'}</td>
                    </tr>
                    {isOpen && (
                      <tr className="call-detail">
                        <td colSpan={5}>
                          {l.message && <p><strong>Request:</strong> {l.message}</p>}
                          {l.email && <p><strong>Email:</strong> <a href={`mailto:${l.email}`} className="muted-link">{l.email}</a></p>}
                          <div className="lead-actions">
                            <button className="btn-secondary" disabled={busy === l.id} onClick={() => move(l, 'estimate_sent')}
                              title="Starts 5 follow-up texts over 3 weeks; stops when they reply">📄 Estimate sent</button>
                            <span className="lead-booking">
                              <input type="datetime-local" value={apptAt} onChange={(e) => setApptAt(e.target.value)} />
                              <button className="btn-secondary" disabled={busy === l.id || !apptAt}
                                onClick={() => move(l, 'booked', { appointment_at: new Date(apptAt).toISOString() })}
                                title="Texts them a reminder the day before and 2 hours before">📅 Booked</button>
                            </span>
                            <button className="btn-secondary" disabled={busy === l.id} onClick={() => move(l, 'job_done')}
                              title="Texts them a review request within the hour">⭐ Job done</button>
                            <button className="btn-secondary" disabled={busy === l.id} onClick={() => move(l, 'won')}>✓ Won</button>
                            <button className="btn-secondary" disabled={busy === l.id} onClick={() => move(l, 'lost')}>✕ Lost</button>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
