import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import ReviewFunnel from './ReviewFunnel.jsx';
import './index.css';

// No router lib in this project — just hand-parse the two review-funnel
// paths and fall back to the dashboard for everything else.
const reviewMatch = window.location.pathname.match(/^\/review\/([^/]+)(\/feedback)?\/?$/);

const root = reviewMatch
  ? <ReviewFunnel requestId={reviewMatch[1]} isFeedbackPage={!!reviewMatch[2]} />
  : <App />;

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    {root}
  </React.StrictMode>
);
