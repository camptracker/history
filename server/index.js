import express from 'express';
import cors from 'cors';
import cron from 'node-cron';
import path from 'path';
import { fileURLToPath } from 'url';
import { connectDB, FeedItem } from './db.js';
import { generateMore } from './generate.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3001;

function pad(n) { return String(n).padStart(2, '0'); }
function todayStr() { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`; }

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../client/dist')));

// All items, newest first
app.get('/api/feed', async (req, res) => {
  try {
    const items = await FeedItem.find().sort({ createdAt: -1 });
    res.json({ items, count: items.length });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// Generate more content (appends, never replaces)
app.post('/api/generate', async (req, res) => {
  try {
    const items = await generateMore();
    res.json({ ok: true, items, count: items.length });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// One-time dedup endpoint
app.post('/api/dedup', async (req, res) => {
  try {
    const all = await FeedItem.find().sort({ createdAt: 1 });
    const seenTitles = new Set();
    const seenVideoIds = new Set();
    const toDelete = [];

    for (const item of all) {
      const titleKey = (item.title || '').toLowerCase().trim();
      const videoId = item.metadata?.videoId;

      let isDupe = false;
      if (titleKey && seenTitles.has(titleKey)) isDupe = true;
      if (videoId && seenVideoIds.has(videoId)) isDupe = true;

      if (isDupe) {
        toDelete.push(item._id);
      } else {
        if (titleKey) seenTitles.add(titleKey);
        if (videoId) seenVideoIds.add(videoId);
      }
    }

    if (toDelete.length > 0) {
      await FeedItem.deleteMany({ _id: { $in: toDelete } });
    }

    const remaining = await FeedItem.countDocuments();
    res.json({ ok: true, deleted: toDelete.length, remaining });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../client/dist/index.html'));
});

// Daily cron at midnight PST
cron.schedule('0 0 * * *', async () => {
  console.log('[CRON] Generating daily feed...');
  await generateMore();
  console.log('[CRON] Done.');
}, { timezone: 'America/Los_Angeles' });

await connectDB();
app.listen(PORT, '0.0.0.0', () => console.log(`Daily Discovery Feed API on port ${PORT}`));
