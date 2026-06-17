import { useState, useEffect } from 'react';

// ─── Star Rating ─────────────────────────────────────────────────────────────

function StarRating({ value, onChange }) {
  return (
    <div className="star-row">
      {[1, 2, 3, 4, 5].map(n => (
        <button
          key={n}
          type="button"
          className={`star ${n <= value ? 'star-filled' : ''}`}
          onClick={() => onChange(n)}
          aria-label={`${n} star${n > 1 ? 's' : ''}`}
        >★</button>
      ))}
    </div>
  );
}

// ─── Page 1 — Rating ─────────────────────────────────────────────────────────

function RatingPage({ requestId, info, onSubmitted }) {
  const [rating,    setRating]    = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [err,        setErr]        = useState('');

  async function handleSubmit() {
    if (!rating) return;
    setSubmitting(true);
    setErr('');
    try {
      const r = await fetch('/api/review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: requestId, rating }),
      });
      if (!r.ok) throw new Error('Something went wrong — please try again.');

      if (rating === 5 && info.google_review_link) {
        window.location.href = info.google_review_link;
        return;
      }
      onSubmitted(rating);
    } catch (e) {
      setErr(e.message);
      setSubmitting(false);
    }
  }

  return (
    <div className="login-card review-card">
      <div className="logo">⭐</div>
      <h1>{info.business_name || 'How did we do?'}</h1>
      <p>How was your experience today?</p>
      <StarRating value={rating} onChange={setRating} />
      <button
        className="btn-primary"
        disabled={!rating || submitting}
        onClick={handleSubmit}
      >
        {submitting ? 'Submitting…' : 'Submit'}
      </button>
      {err && <div className="login-error">{err}</div>}
    </div>
  );
}

// ─── Page 2 — Private Feedback ───────────────────────────────────────────────

function FeedbackPage({ requestId, info }) {
  const [name,     setName]     = useState(info.patient_name || '');
  const [feedback, setFeedback] = useState('');
  const [done,      setDone]      = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [err,        setErr]        = useState('');

  async function handleSubmit(e) {
    e.preventDefault();
    setSubmitting(true);
    setErr('');
    try {
      const r = await fetch('/api/review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: requestId, name, feedback }),
      });
      if (!r.ok) throw new Error('Something went wrong — please try again.');
      setDone(true);
    } catch (e) {
      setErr(e.message);
    } finally {
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <div className="login-card review-card">
        <div className="logo">🙏</div>
        <h1>Thank you</h1>
        <p>Your feedback helps {info.business_name || 'us'} improve. We appreciate you taking the time.</p>
      </div>
    );
  }

  return (
    <div className="login-card review-card">
      <div className="logo">💬</div>
      <h1>We're sorry to hear that</h1>
      <p>Help {info.business_name || 'us'} improve</p>
      <form onSubmit={handleSubmit}>
        <input
          placeholder="Your name"
          value={name}
          onChange={e => setName(e.target.value)}
        />
        <textarea
          className="review-textarea"
          placeholder="What could we have done better?"
          value={feedback}
          onChange={e => setFeedback(e.target.value)}
          rows={5}
        />
        <button type="submit" className="btn-primary" disabled={submitting || !feedback.trim()}>
          {submitting ? 'Submitting…' : 'Submit'}
        </button>
      </form>
      {err && <div className="login-error">{err}</div>}
    </div>
  );
}

// ─── Root ────────────────────────────────────────────────────────────────────

export default function ReviewFunnel({ requestId, isFeedbackPage }) {
  const [info,    setInfo]    = useState(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');
  const [stage,   setStage]   = useState(isFeedbackPage ? 'feedback' : 'rating');

  useEffect(() => {
    fetch(`/api/review?id=${encodeURIComponent(requestId)}`)
      .then(r => {
        if (!r.ok) throw new Error('This review link is invalid or has expired.');
        return r.json();
      })
      .then(setInfo)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [requestId]);

  if (loading) return <div className="page-center"><div className="spinner" /> Loading…</div>;
  if (error)   return <div className="login-wrap"><div className="error-banner">⚠️ {error}</div></div>;

  return (
    <div className="login-wrap">
      {stage === 'rating'
        ? <RatingPage requestId={requestId} info={info} onSubmitted={() => {
            window.history.pushState({}, '', `/review/${requestId}/feedback`);
            setStage('feedback');
          }} />
        : <FeedbackPage requestId={requestId} info={info} />}
    </div>
  );
}
