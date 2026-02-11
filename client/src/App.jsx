import { useState, useEffect, useCallback } from 'react';
import './App.css';

const API = import.meta.env.VITE_API_URL || '';

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
        {item.date && <span className="feed-card__date">{item.date}</span>}
      </div>

      {item.imageUrl && item.type !== 'book' && (
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
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [generating, setGenerating] = useState(false);

  const fetchFeed = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API}/api/feed`);
      const json = await res.json();
      setItems(json.items || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchFeed(); }, [fetchFeed]);

  const handleGenerateMore = async () => {
    setGenerating(true);
    try {
      const res = await fetch(`${API}/api/generate`, { method: 'POST' });
      const json = await res.json();
      if (json.items?.length > 0) {
        // Optimistically append new items to the bottom
        setItems(prev => [...prev, ...json.items]);
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="app">
      <header className="header">
        <h1 className="title">Daily Discovery</h1>
        <p className="subtitle">Your curated feed of videos, books, trends & history</p>
      </header>

      {loading && (
        <div className="loading">
          <div className="spinner" />
          <p>Loading feed...</p>
        </div>
      )}

      {error && <div className="error">⚠️ {error}</div>}

      {!loading && !error && (
        <>
          <div className="feed">
            {items.length === 0 && <p className="empty">No items yet. Generate some content below!</p>}
            {items.map((item, i) => (
              <FeedCard key={item._id || i} item={item} />
            ))}
          </div>

          <div className="generate-more">
            <button className="generate-btn" onClick={handleGenerateMore} disabled={generating}>
              {generating ? '⏳ Discovering...' : '✨ Discover More'}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
