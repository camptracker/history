import express from 'express';
import cors from 'cors';
import cron from 'node-cron';
import path from 'path';
import { fileURLToPath } from 'url';
import { connectDB, FeedItem } from './db.js';
import { generateForDate } from './generate.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3001;

function pad(n) { return String(n).padStart(2, '0'); }
function todayStr() { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`; }

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../client/dist')));

app.get('/api/feed/:date', async (req, res) => {
  try {
    const { date } = req.params;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: 'Date must be YYYY-MM-DD format' });
    }
    const items = await FeedItem.find({ date }).sort({ createdAt: 1 });
    res.json({ date, items, count: items.length });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/dates', async (req, res) => {
  try {
    const dates = await FeedItem.distinct('date');
    dates.sort();
    res.json(dates);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/generate', async (req, res) => {
  try {
    const date = req.body.date || todayStr();
    const count = await generateForDate(date);
    res.json({ ok: true, date, count });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../client/dist/index.html'));
});

cron.schedule('0 0 * * *', async () => {
  console.log('[CRON] Generating daily feed...');
  await generateForDate(todayStr());
  console.log('[CRON] Done.');
}, { timezone: 'America/Los_Angeles' });

await connectDB();
app.listen(PORT, '0.0.0.0', () => console.log(`Daily Discovery Feed API on port ${PORT}`));
