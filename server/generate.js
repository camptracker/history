import { connectDB, FeedItem } from './db.js';

function pad(n) { return String(n).padStart(2, '0'); }

async function fetchJSON(url, headers = {}) {
  const res = await fetch(url, { headers: { 'User-Agent': 'DailyDiscoveryFeed/1.0', ...headers } });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

async function generateVideos(date) {
  // Get all previously used video IDs to avoid duplicates
  const existingVideos = await FeedItem.find({ type: 'video', 'metadata.videoId': { $ne: null } }).select('metadata.videoId');
  const seenIds = new Set(existingVideos.map(v => v.metadata?.videoId).filter(Boolean));

  const queries = ['best salsa dancing', 'acoustic guitar cover'];
  const items = [];
  for (const q of queries) {
    try {
      const searchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`;
      const res = await fetch(searchUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
      });
      const html = await res.text();
      // Find all video IDs and pick the first one we haven't seen
      const allMatches = [...html.matchAll(/"videoId":"([a-zA-Z0-9_-]{11})"/g)].map(m => m[1]);
      const uniqueIds = [...new Set(allMatches)];
      const videoId = uniqueIds.find(id => !seenIds.has(id)) || uniqueIds[0] || null;
      if (videoId) seenIds.add(videoId); // prevent same video in both queries

      if (videoId) {
        let title = q;
        let channelName = '';
        const thumbnail = `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;
        try {
          const oembed = await fetchJSON(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`);
          title = oembed.title || q;
          channelName = oembed.author_name || '';
        } catch {}

        items.push({
          date, type: 'video', title,
          description: channelName ? `By ${channelName}` : '',
          summary: `Top result for "${q}" on YouTube`,
          imageUrl: thumbnail,
          links: [{ label: 'Watch on YouTube', url: `https://www.youtube.com/watch?v=${videoId}` }],
          metadata: { videoId, channelName, viewCount: null, duration: null },
        });
      } else {
        items.push({
          date, type: 'video',
          title: `${q} — Search YouTube`,
          description: `Search YouTube for the latest ${q} videos`,
          summary: `Curated search for "${q}"`,
          imageUrl: null,
          links: [{ label: 'Search YouTube', url: searchUrl }],
          metadata: { videoId: null, channelName: null, viewCount: null, duration: null },
        });
      }
    } catch (e) {
      console.error(`Video generation failed for "${q}":`, e.message);
      items.push({
        date, type: 'video',
        title: q,
        description: `Search YouTube for ${q}`,
        summary: `Discover ${q} videos`,
        imageUrl: null,
        links: [{ label: 'Search YouTube', url: `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}` }],
        metadata: { videoId: null, channelName: null, viewCount: null, duration: null },
      });
    }
  }
  return items;
}

async function generateBooks(date) {
  // Check previously used book titles to avoid duplicates
  const existingBooks = await FeedItem.find({ type: 'book' }).select('title');
  const seenTitles = new Set(existingBooks.map(b => b.title?.toLowerCase()));

  const data = await fetchJSON('https://www.googleapis.com/books/v1/volumes?q=subject:self-help&orderBy=newest&maxResults=10');
  // Filter out previously shown books, then take 2
  const books = (data.items || [])
    .filter(b => !seenTitles.has((b.volumeInfo?.title || '').toLowerCase()))
    .slice(0, 2);
  return books.map(b => {
    const info = b.volumeInfo || {};
    const author = (info.authors || ['Unknown'])[0];
    return {
      date, type: 'book',
      title: info.title || 'Untitled',
      description: info.description || info.subtitle || '',
      summary: info.description || info.subtitle || '',
      imageUrl: info.imageLinks?.thumbnail || null,
      links: [
        ...(info.previewLink ? [{ label: 'Preview on Google Books', url: info.previewLink }] : []),
        ...(info.infoLink ? [{ label: 'More Info', url: info.infoLink }] : []),
      ],
      metadata: { author, quotes: [] },
    };
  });
}

async function generateFashion(date) {
  const month = parseInt(date.split('-')[1]);
  const season = month <= 2 || month === 12 ? 'winter' : month <= 5 ? 'spring' : month <= 8 ? 'summer' : 'fall';
  const trends = {
    winter: { title: 'Quiet Luxury & Layered Knits', desc: 'Oversized cashmere, tonal layering, and minimalist accessories define this season.' },
    spring: { title: 'Sheer Fabrics & Pastel Power', desc: 'Translucent layers and soft pastels take center stage for spring.' },
    summer: { title: 'Coastal Grandmother & Linen Everything', desc: 'Relaxed linen sets, woven bags, and effortless seaside elegance.' },
    fall: { title: 'Dark Academia & Rich Textures', desc: 'Tweed, leather, deep burgundy, and scholarly silhouettes make a comeback.' },
  };
  const trend = trends[season];
  return [{
    date, type: 'fashion',
    title: trend.title,
    description: trend.desc,
    summary: `${season.charAt(0).toUpperCase() + season.slice(1)} fashion trend`,
    imageUrl: null,
    links: [{ label: 'Explore on Pinterest', url: `https://www.pinterest.com/search/pins/?q=${encodeURIComponent(trend.title)}` }],
    metadata: { source: 'Seasonal curation' },
  }];
}

async function generateAITrend(date) {
  // Get previously used HN story IDs
  const existingAI = await FeedItem.find({ type: 'ai_trend' }).select('links');
  const seenUrls = new Set(existingAI.flatMap(a => (a.links || []).map(l => l.url)));

  const topIds = await fetchJSON('https://hacker-news.firebaseio.com/v0/topstories.json');
  const aiKeywords = ['ai', 'llm', 'gpt', 'openai', 'anthropic', 'claude', 'gemini', 'machine learning', 'neural', 'transformer'];

  for (const id of topIds.slice(0, 60)) {
    try {
      const story = await fetchJSON(`https://hacker-news.firebaseio.com/v0/item/${id}.json`);
      if (!story || !story.title) continue;
      const titleLower = story.title.toLowerCase();
      const hnUrl = `https://news.ycombinator.com/item?id=${story.id}`;
      if (aiKeywords.some(kw => titleLower.includes(kw)) && !seenUrls.has(hnUrl)) {
        return [{
          date, type: 'ai_trend',
          title: story.title,
          description: story.text ? story.text.replace(/<[^>]+>/g, '').slice(0, 500) : `Trending AI story from Hacker News with ${story.score || 0} points`,
          summary: `HN Score: ${story.score || 0} | ${story.descendants || 0} comments`,
          imageUrl: null,
          links: [
            ...(story.url ? [{ label: 'Read Article', url: story.url }] : []),
            { label: 'HN Discussion', url: `https://news.ycombinator.com/item?id=${story.id}` },
          ],
          metadata: { source: 'Hacker News' },
        }];
      }
    } catch {}
  }
  return [{
    date, type: 'ai_trend',
    title: 'AI Industry Update',
    description: 'Check the latest developments in artificial intelligence.',
    summary: 'Daily AI roundup',
    imageUrl: null,
    links: [{ label: 'Hacker News', url: 'https://news.ycombinator.com/' }],
    metadata: { source: 'Hacker News' },
  }];
}

async function generateHistory(date) {
  const [, mm, dd] = date.split('-');
  const url = `https://en.wikipedia.org/api/rest_v1/feed/onthisday/all/${mm}/${dd}`;
  const data = await fetchJSON(url);

  const events = data.events || [];
  if (events.length === 0) return [];

  events.sort((a, b) => (b.pages?.length || 0) - (a.pages?.length || 0));
  const ev = events[0];
  const page = ev.pages?.[0];
  const thumbnail = page?.thumbnail?.source || null;
  const wikiUrl = page?.content_urls?.desktop?.page || (page?.title ? `https://en.wikipedia.org/wiki/${encodeURIComponent(page.title)}` : null);

  return [{
    date, type: 'history',
    title: `${ev.year}: ${(ev.text || 'Historical Event').slice(0, 100)}`,
    description: ev.text || '',
    summary: page?.extract || ev.text || '',
    imageUrl: thumbnail,
    links: wikiUrl ? [{ label: 'Read on Wikipedia', url: wikiUrl }] : [],
    metadata: { year: ev.year, wikiUrl },
  }];
}

export async function generateForDate(dateStr) {
  console.log(`Generating feed for ${dateStr}...`);

  await FeedItem.deleteMany({ date: dateStr });

  const generators = [
    { name: 'videos', fn: () => generateVideos(dateStr) },
    { name: 'books', fn: () => generateBooks(dateStr) },
    { name: 'fashion', fn: () => generateFashion(dateStr) },
    { name: 'ai_trend', fn: () => generateAITrend(dateStr) },
    { name: 'history', fn: () => generateHistory(dateStr) },
  ];

  const allItems = [];
  for (const gen of generators) {
    try {
      const items = await gen.fn();
      allItems.push(...items);
      console.log(`  ✓ ${gen.name}: ${items.length} items`);
    } catch (e) {
      console.error(`  ✗ ${gen.name} failed:`, e.message);
    }
  }

  if (allItems.length > 0) {
    await FeedItem.insertMany(allItems);
  }

  console.log(`Generated ${allItems.length} items for ${dateStr}`);
  return allItems.length;
}

// CLI
if (process.argv[1]?.endsWith('generate.js')) {
  await connectDB();
  const args = process.argv.slice(2);
  const dates = [];
  if (args.length) {
    for (const a of args) dates.push(a);
  } else {
    const today = new Date();
    dates.push(`${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`);
  }
  for (const d of dates) await generateForDate(d);
  process.exit(0);
}
