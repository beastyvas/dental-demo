import { useState, useEffect } from 'react';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function timeAgo(iso) {
  const diff  = Date.now() - new Date(iso).getTime();
  const mins  = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days  = Math.floor(diff / 86400000);
  if (mins  <  2) return 'just now';
  if (mins  < 60) return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days  <  7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function StarsDisplay({ rating }) {
  if (rating == null) return <span className="cute-pill cute-pill-waiting">awaiting reply</span>;
  return (
    <span className="cute-stars-display">
      {'★'.repeat(rating)}{'☆'.repeat(5 - rating)}
    </span>
  );
}

// ─── History row ─────────────────────────────────────────────────────────────

function HistoryRow({ entry }) {
  return (
    <div className="cute-history-row">
      <div className="cute-history-main">
        <span className="cute-history-name">{entry.patient_name || 'Someone lovely'}</span>
        <span className="cute-history-phone">{entry.patient_phone}</span>
      </div>
      <div className="cute-history-meta">
        <StarsDisplay rating={entry.rating} />
        <span className="cute-history-time">{timeAgo(entry.sent_at)}</span>
      </div>
      {entry.feedback && <div className="cute-history-feedback">"{entry.feedback}"</div>}
    </div>
  );
}

// ─── Root ────────────────────────────────────────────────────────────────────

export default function CuteReviewDashboard({ token, businessName, onLogout }) {
  const [entries,  setEntries]  = useState([]);
  const [stats,    setStats]    = useState(null);
  const [loading,  setLoading]  = useState(true);
  const [phone,    setPhone]    = useState('');
  const [name,     setName]     = useState('');
  const [sending,  setSending]  = useState(false);
  const [toast,    setToast]    = useState('');
  const [err,      setErr]      = useState('');

  const authHeaders = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  async function load() {
    setLoading(true);
    try {
      const r = await fetch('/api/dashboard/review-requests', { headers: authHeaders });
      if (!r.ok) throw new Error('Could not load your history');
      const data = await r.json();
      setEntries(data.entries ?? []);
      setStats(data.stats ?? null);
    } catch (e) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [token]);
  useEffect(() => {
    document.title = `${businessName || 'Reviews'} 💕`;
  }, [businessName]);

  async function handleSend(e) {
    e.preventDefault();
    setSending(true);
    setErr('');
    setToast('');
    try {
      const r = await fetch('/api/dashboard/review-requests', {
        method: 'POST', headers: authHeaders,
        body: JSON.stringify({ patient_name: name, patient_phone: phone }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'Something went wrong — try again?');
      setPhone('');
      setName('');
      setToast('Sent ✓');
      load();
    } catch (e) {
      setErr(e.message);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="cute-wrap">
      <div className="cute-blob cute-blob-1" />
      <div className="cute-blob cute-blob-2" />

      <header className="cute-topbar">
        <div className="cute-brand">
          <span className="cute-brand-emoji">🐆</span>
          <span className="cute-brand-name">{businessName || 'Your Reviews'}</span>
        </div>
        <button className="cute-logout" onClick={onLogout}>Sign out</button>
      </header>

      <main className="cute-main">
        <div className="cute-card cute-card-hero">
          <div className="cute-hero-emoji">💋</div>
          <h1>Ask for a review</h1>
          <p className="cute-hero-sub">Just their number — that's it!</p>

          <form className="cute-form" onSubmit={handleSend}>
            <input
              className="cute-input"
              placeholder="Their phone number"
              value={phone}
              onChange={e => setPhone(e.target.value)}
              required
            />
            <input
              className="cute-input cute-input-optional"
              placeholder="Their name (optional)"
              value={name}
              onChange={e => setName(e.target.value)}
            />
            <button className="cute-btn-send" disabled={sending}>
              {sending ? 'Sending…' : 'Send Review Request'}
            </button>
          </form>

          {toast && <div className="cute-toast">{toast}</div>}
          {err   && <div className="cute-error">{err}</div>}
        </div>

        {stats && (
          <div className="cute-stats-row">
            <div className="cute-stat-card">
              <div className="cute-stat-num">{stats.sent}</div>
              <div className="cute-stat-label">sent</div>
            </div>
            <div className="cute-stat-card">
              <div className="cute-stat-num">{stats.avgRating ?? '—'}</div>
              <div className="cute-stat-label">avg ★</div>
            </div>
            <div className="cute-stat-card">
              <div className="cute-stat-num">{stats.clicked}</div>
              <div className="cute-stat-label">opened</div>
            </div>
          </div>
        )}

        <div className="cute-card cute-card-history">
          <h2 className="cute-history-title">Recent requests</h2>
          {loading ? (
            <div className="cute-loading">loading…</div>
          ) : entries.length === 0 ? (
            <div className="cute-empty">No requests yet — send your first one above 🐆</div>
          ) : (
            <div className="cute-history-list">
              {entries.map(e => <HistoryRow key={e.id} entry={e} />)}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
