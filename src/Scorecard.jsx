// "What we did for you this month" — the same numbers the monthly scorecard
// text sends, for this month so far or last month.
import { useEffect, useState } from 'react';

const SOURCE = {
  call: 'Phone', form: 'Website', email: 'Email', angi: 'Angi', thumbtack: 'Thumbtack', meta: 'Facebook',
  reactivation: 'Reactivation', manual: 'Added', jobber: 'Jobber', hcp: 'Housecall Pro',
};
const secs = (s) => (s == null ? '—' : s < 60 ? `${Math.round(s)}s` : `${Math.round(s / 60)}m`);
const money = (n) => `$${Math.round(n).toLocaleString('en-US')}`;
const prevMonth = (m) => { const [y, mo] = m.split('-').map(Number); return mo === 1 ? `${y - 1}-12` : `${y}-${String(mo - 1).padStart(2, '0')}`; };
const label = (m) => new Date(`${m}-15T12:00:00Z`).toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });

export default function Scorecard({ token, clientId }) {
  const [month, setMonth] = useState(null);
  const [thisMonth, setThisMonth] = useState(null);
  const [sc, setSc] = useState(null);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    const q = new URLSearchParams({ ...(clientId ? { adminClientId: clientId } : {}), ...(month ? { month } : {}) });
    fetch(`/api/dashboard/scorecard?${q}`, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => (r.ok ? r.json() : { setupNeeded: true }))
      .then((d) => {
        if (d.setupNeeded || !d.scorecard) { setHidden(true); return; }
        setSc(d.scorecard);
        setThisMonth(d.thisMonth);
        if (!month) setMonth(d.scorecard.month);
      });
  }, [token, clientId, month]);

  if (hidden || !sc) return null;
  const sources = Object.entries(sc.bySource).sort((a, b) => b[1] - a[1]);

  return (
    <section className="calls-section">
      <div className="calls-header">
        <h2>Scorecard — {label(sc.month)}{sc.month === thisMonth ? ' so far' : ''}</h2>
        <div className="scorecard-months">
          <button className={`btn-filter ${sc.month === thisMonth ? 'active' : ''}`} onClick={() => setMonth(thisMonth)}>This month</button>
          <button className={`btn-filter ${sc.month === prevMonth(thisMonth) ? 'active' : ''}`} onClick={() => setMonth(prevMonth(thisMonth))}>Last month</button>
        </div>
      </div>
      <div className="stats-row">
        <div className="stat-card accent">
          <div className="label">Calls answered</div>
          <div className="value">{sc.callsAnswered}{sc.afterHours ? <span className="value-sub"> · {sc.afterHours} after hours</span> : null}</div>
        </div>
        <div className="stat-card success">
          <div className="label">Jobs booked</div>
          <div className="value">{sc.booked}</div>
        </div>
        <div className="stat-card">
          <div className="label">Lead response</div>
          <div className="value">{secs(sc.medianResponseSeconds)}{sc.outsideLeads ? <span className="value-sub"> · {sc.answeredUnder5min}/{sc.outsideLeads} in 5 min</span> : null}</div>
        </div>
        <div className="stat-card">
          <div className="label">Est. value</div>
          <div className="value">{money(sc.estimatedValue)}<span className="value-sub"> at {money(sc.avgJobValue)}/job</span></div>
        </div>
      </div>
      <p className="scorecard-detail">
        {sc.leads} leads{sources.length ? ` — ${sources.map(([k, v]) => `${SOURCE[k] ?? k} ${v}`).join(', ')}` : ''}.
        {sc.estimateLeadsFollowedUp ? ` ${sc.estimateLeadsFollowedUp} estimates followed up, ${sc.estimateReplies} replied.` : ''}
        {sc.reviewRequests ? ` ${sc.reviewRequests} review requests${sc.avgRating ? `, avg ${sc.avgRating}★` : ''}.` : ''}
      </p>
    </section>
  );
}
