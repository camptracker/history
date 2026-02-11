import { useState, useEffect, useCallback } from 'react';
import './App.css';

const API = import.meta.env.VITE_API_URL || '';

function pad(n) { return String(n).padStart(2, '0'); }
function dateStr(d) { return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`; }
function formatDate(d) {
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
}
function shiftDate(d, offset) { const n = new Date(d); n.setDate(n.getDate() + offset); return n; }

const TYPE_CONFIG = {
  video: { emoji: '🎬', label: 'Video', color: '#e74c3c' },
  book: { emoji: '📚', label: 'Book', color: '#9b59b6' },
  fashion: { emoji: '👗', label: 'Fashion', color: '#e91e8c' },
  ai_trend: { emoji: '🤖', label: 'AI Trend', color: '#00d4ff' },
  history: { emoji: '📜', label: 'History', color: '#2cb67d' },
};

function FeedCard({ item }) {
  const cfg = TYPE_CONFIG[item.type] || TYPE_CONFIG.history;

  return (
    <article className={`feed-card feed-card--${item.type}`} style={{ '--card-accent': cfg.color }}>
      <div className="feed-card__badge">
        <span className="feed-card__emoji">{cfg.emoji}</span>
        <span className="feed-card__type">{cfg.label}</span>
      </div>

      {item.imageUrl && (
        <div className={`feed-card__image ${item.type === 'fashion' ? 'feed-card__image--large' : ''}`}>
          <img src={item.imageUrl} alt={item.title} loading="lazy" />
        </div>
      )}

      <div className="feed-card__body">
        <h3 className="feed-card__title">{item.title}</h3>

        {item.type === 'history' && item.metadata?.year && (
          <span className="feed-card__year-badge">{item.metadata.year}</span>
        )}

        {item.type === 'book' && item.metadata?.author && (
          <p className="feed-card__author">by {item.metadata.author}</p>
        )}

        <p className="feed-card__desc">{item.description || item.summary}</p>

        {item.type === 'book' && item.metadata?.quotes?.length > 0 && (
          <div className="feed-card__quotes">
            {item.metadata.quotes.map((q, i) => (
              <blockquote key={i} className="feed-card__quote">&ldquo;{q}&rdquo;</blockquote>
            ))}
          </div>
        )}

        {item.type === 'video' && item.metadata?.channelName && (
          <p className="feed-card__channel">📺 {item.metadata.channelName}</p>
        )}

        {item.links?.length > 0 && (
          <div className="feed-card__links">
            {item.links.map((l, i) => (
              <a key={i} href={l.url} target="_blank" rel="noopener noreferrer" className="feed-card__link">
                {l.label} →
              </a>
            ))}
          </div>
        )}
      </div>
    </article>
  );
}

export default function App() {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [generating, setGenerating] = useState(false);

  const fetchFeed = useCallback(async (date) => {
    setLoading(true);
    setError(null);
    try {
      const ds = dateStr(date);
      const res = await fetch(`${API}/api/feed/${ds}`);
      const json = await res.json();
      if (json.count === 0) {
        setGenerating(true);
        await fetch(`${API}/api/generate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ date: ds }),
        });
        setGenerating(false);
        const res2 = await fetch(`${API}/api/feed/${ds}`);
        const json2 = await res2.json();
        setItems(json2.items || []);
      } else {
        setItems(json.items || []);
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
      setGenerating(false);
    }
  }, []);

  useEffect(() => { fetchFeed(currentDate); }, [currentDate, fetchFeed]);

  const goNext = () => setCurrentDate(d => shiftDate(d, 1));
  const goPrev = () => setCurrentDate(d => shiftDate(d, -1));
  const goToday = () => setCurrentDate(new Date());

  const handleRegenerate = async () => {
    setGenerating(true);
    try {
      const ds = dateStr(currentDate);
      await fetch(`${API}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date: ds }),
      });
      await fetchFeed(currentDate);
    } finally {
      setGenerating(false);
    }
  };

  const typeOrder = ['video', 'book', 'fashion', 'ai_trend', 'history'];
  const sorted = [...items].sort((a, b) => typeOrder.indexOf(a.type) - typeOrder.indexOf(b.type));

  return (
    <div className="app">
      <header className="header">
        <h1 className="title">Daily Discovery</h1>
        <p className="subtitle">Your curated feed of videos, books, trends & history</p>
      </header>

      <nav className="date-nav">
        <button className="nav-btn" onClick={goPrev}>‹ Prev</button>
        <div className="date-display">
          <h2>{formatDate(currentDate)}</h2>
          <button className="today-btn" onClick={goToday}>Today</button>
        </div>
        <button className="nav-btn" onClick={goNext}>Next ›</button>
      </nav>

      <div className="controls">
        <button className="regen-btn" onClick={handleRegenerate} disabled={generating}>
          {generating ? '⏳ Generating...' : '🔄 Regenerate Feed'}
        </button>
      </div>

      {loading && (
        <div className="loading">
          <div className="spinner" />
          <p>{generating ? 'Discovering content for you...' : 'Loading feed...'}</p>
        </div>
      )}

      {error && <div className="error">⚠️ {error}</div>}

      {!loading && !error && (
        <div className="feed">
          {sorted.length === 0 && <p className="empty">No items yet. Hit Regenerate!</p>}
          {sorted.map((item, i) => (
            <FeedCard key={item._id || i} item={item} />
          ))}
        </div>
      )}
    </div>
  );
}
