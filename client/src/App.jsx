import { useState, useEffect, useCallback } from 'react';
import './App.css';

const API = import.meta.env.VITE_API_URL || 'http://localhost:3001';

const MONTHS = ['January','February','March','April','May','June',
  'July','August','September','October','November','December'];

function pad(n) { return String(n).padStart(2, '0'); }

function dateKey(d) { return `${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }

function formatDate(d) {
  return `${MONTHS[d.getMonth()]} ${d.getDate()}`;
}

function shiftDate(d, offset) {
  const n = new Date(d);
  n.setDate(n.getDate() + offset);
  return n;
}

const TYPE_CONFIG = {
  event: { label: 'Events', emoji: '📜', color: 'var(--event)' },
  birth: { label: 'Births', emoji: '🎂', color: 'var(--birth)' },
  death: { label: 'Deaths', emoji: '🕊️', color: 'var(--death)' },
};

function EventCard({ item }) {
  const cfg = TYPE_CONFIG[item.type] || TYPE_CONFIG.event;
  const thumb = item.pages?.[0]?.thumbnail;

  return (
    <div className="event-card" style={{ borderLeftColor: cfg.color }}>
      <div className="event-content">
        <div className="event-header">
          {item.year && <span className="event-year" style={{ color: cfg.color }}>{item.year}</span>}
          <span className="event-type-badge" style={{ background: cfg.color }}>{cfg.emoji}</span>
        </div>
        <p className="event-text">{item.text}</p>
        {item.pages?.length > 0 && (
          <div className="event-links">
            {item.pages.map((p, i) => (
              <a key={i} href={p.url} target="_blank" rel="noopener noreferrer" className="wiki-link">
                {p.title} →
              </a>
            ))}
          </div>
        )}
      </div>
      {thumb && (
        <div className="event-thumb">
          <img src={thumb} alt="" loading="lazy" />
        </div>
      )}
    </div>
  );
}

export default function App() {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState('all');
  const [generating, setGenerating] = useState(false);

  const fetchEvents = useCallback(async (date) => {
    setLoading(true);
    setError(null);
    try {
      const key = dateKey(date);
      const res = await fetch(`${API}/api/events/${key}`);
      const json = await res.json();
      if (json.count === 0) {
        // No data yet — try generating
        setGenerating(true);
        const mm = date.getMonth() + 1;
        const dd = date.getDate();
        const yyyy = date.getFullYear();
        const genRes = await fetch(`${API}/api/generate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ date: `${yyyy}-${pad(mm)}-${pad(dd)}` }),
        });
        await genRes.json();
        setGenerating(false);
        // Re-fetch
        const res2 = await fetch(`${API}/api/events/${key}`);
        const json2 = await res2.json();
        setData(json2);
      } else {
        setData(json);
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
      setGenerating(false);
    }
  }, []);

  useEffect(() => { fetchEvents(currentDate); }, [currentDate, fetchEvents]);

  const goNext = () => setCurrentDate(d => shiftDate(d, 1));
  const goPrev = () => setCurrentDate(d => shiftDate(d, -1));
  const goToday = () => setCurrentDate(new Date());

  const handleRegenerate = async () => {
    setGenerating(true);
    try {
      await fetch(`${API}/api/generate`, { method: 'POST' });
      await fetchEvents(currentDate);
    } finally {
      setGenerating(false);
    }
  };

  const allEvents = data ? [...(data.events || []), ...(data.births || []), ...(data.deaths || [])] : [];
  const filtered = filter === 'all' ? allEvents : allEvents.filter(e => e.type === filter);
  const sorted = [...filtered].sort((a, b) => {
    const ya = parseInt(a.year) || 0;
    const yb = parseInt(b.year) || 0;
    return ya - yb;
  });

  return (
    <div className="app">
      <header className="header">
        <h1 className="title">On This Day</h1>
        <p className="subtitle">Moments that shaped history</p>
      </header>

      <div className="date-nav">
        <button className="nav-btn" onClick={goPrev}>← Prev</button>
        <div className="date-display">
          <h2>{formatDate(currentDate)}</h2>
          <button className="today-btn" onClick={goToday}>Today</button>
        </div>
        <button className="nav-btn" onClick={goNext}>Next →</button>
      </div>

      <div className="controls">
        <div className="filters">
          {['all', 'event', 'birth', 'death'].map(f => (
            <button
              key={f}
              className={`filter-btn ${filter === f ? 'active' : ''}`}
              onClick={() => setFilter(f)}
              style={f !== 'all' && filter === f ? { background: TYPE_CONFIG[f].color } : {}}
            >
              {f === 'all' ? '🌍 All' : `${TYPE_CONFIG[f].emoji} ${TYPE_CONFIG[f].label}`}
            </button>
          ))}
        </div>
        <button className="regen-btn" onClick={handleRegenerate} disabled={generating}>
          {generating ? '⏳ Generating...' : '🔄 Regenerate'}
        </button>
      </div>

      {loading && (
        <div className="loading">
          <div className="spinner" />
          <p>{generating ? 'Fetching historical data...' : 'Loading...'}</p>
        </div>
      )}

      {error && <div className="error">⚠️ {error}</div>}

      {!loading && !error && (
        <>
          <div className="stats">
            <span>{sorted.length} events</span>
            {data?.generatedAt && (
              <span className="gen-time">
                Generated {new Date(data.generatedAt).toLocaleString()}
              </span>
            )}
          </div>
          <div className="feed">
            {sorted.map((item, i) => (
              <EventCard key={`${item.year}-${item.type}-${i}`} item={item} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
