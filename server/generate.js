import { connectDB, HistoryEvent, DayMeta } from './db.js';

const WIKI_API = 'https://en.wikipedia.org/api/rest_v1/feed/onthisday';

function pad(n) { return String(n).padStart(2, '0'); }

function dateKey(d) { return `${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }

async function fetchDay(month, day) {
  const url = `${WIKI_API}/all/${pad(month)}/${pad(day)}`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'HistoryApp/1.0 (contact: dev@example.com)' }
  });
  if (!res.ok) throw new Error(`Wiki API ${res.status}: ${url}`);
  return res.json();
}

async function fetchExtract(title) {
  try {
    const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'HistoryApp/1.0 (contact: dev@example.com)' }
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.extract || null;
  } catch { return null; }
}

function mapEvents(items, type) {
  return (items || []).map(item => ({
    year: item.year != null ? String(item.year) : '',
    text: item.text || '',
    type,
    pages: (item.pages || []).slice(0, 2).map(p => ({
      title: p.title,
      url: p.content_urls?.desktop?.page || `https://en.wikipedia.org/wiki/${encodeURIComponent(p.title)}`,
      thumbnail: p.thumbnail?.source || null,
      extract: p.extract || null,
    })),
  }));
}

// Enrich births/deaths with Wikipedia extracts (first page only)
async function enrichPeople(events) {
  const people = events.filter(e => e.type === 'birth' || e.type === 'death');
  // Batch in groups of 10 to avoid hammering Wikipedia
  for (let i = 0; i < people.length; i += 10) {
    const batch = people.slice(i, i + 10);
    await Promise.all(batch.map(async (ev) => {
      if (ev.pages?.[0]?.title) {
        const ext = await fetchExtract(ev.pages[0].title);
        if (ext) ev.pages[0].extract = ext;
      }
    }));
  }
  return events;
}

export async function generateForDate(date) {
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const key = dateKey(date);

  console.log(`Generating history for ${key}...`);
  const data = await fetchDay(month, day);

  let events = [
    ...mapEvents(data.events, 'event'),
    ...mapEvents(data.births, 'birth'),
    ...mapEvents(data.deaths, 'death'),
  ];

  // Fetch Wikipedia extracts for people (births/deaths)
  console.log(`Fetching extracts for births/deaths...`);
  events = await enrichPeople(events);

  // Upsert all events
  let saved = 0;
  for (const ev of events) {
    try {
      await HistoryEvent.findOneAndUpdate(
        { date: key, year: ev.year, type: ev.type },
        { ...ev, date: key },
        { upsert: true, new: true }
      );
      saved++;
    } catch (e) {
      if (e.code !== 11000) console.error('Save error:', e.message);
    }
  }

  await DayMeta.findOneAndUpdate(
    { date: key },
    { date: key, generatedAt: new Date(), eventCount: saved },
    { upsert: true }
  );

  console.log(`Saved ${saved} events for ${key}`);
  return saved;
}

// CLI usage: node generate.js [YYYY-MM-DD] [YYYY-MM-DD]
if (process.argv[1]?.endsWith('generate.js')) {
  await connectDB();

  const args = process.argv.slice(2);
  const dates = [];

  if (args.length) {
    for (const a of args) dates.push(new Date(a + 'T12:00:00'));
  } else {
    const today = new Date();
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    dates.push(today, tomorrow);
  }

  for (const d of dates) await generateForDate(d);
  process.exit(0);
}
