import express from 'express';
import cors from 'cors';
import cron from 'node-cron';
import path from 'path';
import { fileURLToPath } from 'url';
import { connectDB, HistoryEvent, DayMeta } from './db.js';
import { generateForDate } from './generate.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// Serve static React build
app.use(express.static(path.join(__dirname, '../client/dist')));

// API: Get events for a date
app.get('/api/events/:date', async (req, res) => {
  try {
    const { date } = req.params; // "MM-DD"
    if (!/^\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: 'Date must be MM-DD format' });
    }

    const meta = await DayMeta.findOne({ date });
    const events = await HistoryEvent.find({ date }).sort({ year: 1 });

    const grouped = {
      events: events.filter(e => e.type === 'event'),
      births: events.filter(e => e.type === 'birth'),
      deaths: events.filter(e => e.type === 'death'),
    };

    res.json({
      date,
      generatedAt: meta?.generatedAt || null,
      count: events.length,
      ...grouped,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// API: List available dates
app.get('/api/dates', async (req, res) => {
  const dates = await DayMeta.find().sort({ date: 1 });
  res.json(dates);
});

// API: Force regenerate
app.post('/api/generate', async (req, res) => {
  try {
    const { date } = req.body; // "YYYY-MM-DD" or omit for today+tomorrow
    const dates = [];

    if (date) {
      dates.push(new Date(date + 'T12:00:00'));
    } else {
      const today = new Date();
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);
      dates.push(today, tomorrow);
    }

    const results = [];
    for (const d of dates) {
      const count = await generateForDate(d);
      results.push({ date: d.toISOString().slice(5, 10).replace('-', '-'), count });
    }

    res.json({ ok: true, results });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// SPA fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../client/dist/index.html'));
});

// Cron: midnight every day — generate today + tomorrow
cron.schedule('0 0 * * *', async () => {
  console.log('[CRON] Midnight generation starting...');
  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  await generateForDate(today);
  await generateForDate(tomorrow);
  console.log('[CRON] Done.');
}, { timezone: 'America/Los_Angeles' });

await connectDB();
app.listen(PORT, () => console.log(`History API running on http://localhost:${PORT}`));
