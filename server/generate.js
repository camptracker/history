import { connectDB, FeedItem } from './db.js';

function pad(n) { return String(n).padStart(2, '0'); }
function todayStr() { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`; }

async function fetchJSON(url, headers = {}) {
  const res = await fetch(url, { headers: { 'User-Agent': 'DailyDiscoveryFeed/1.0', ...headers } });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

// Get all existing titles and videoIds to prevent duplicates
async function getExistingKeys() {
  const all = await FeedItem.find().select('title metadata.videoId links');
  const titles = new Set(all.map(i => (i.title || '').toLowerCase().trim()).filter(Boolean));
  const videoIds = new Set(all.filter(i => i.metadata?.videoId).map(i => i.metadata.videoId));
  const urls = new Set(all.flatMap(i => (i.links || []).map(l => l.url)));
  return { titles, videoIds, urls };
}

function isDuplicate(item, existing) {
  const titleKey = (item.title || '').toLowerCase().trim();
  if (titleKey && existing.titles.has(titleKey)) return true;
  if (item.metadata?.videoId && existing.videoIds.has(item.metadata.videoId)) return true;
  return false;
}

async function generateVideos(existing) {
  const queries = ['best salsa dancing', 'acoustic guitar cover'];
  const items = [];
  for (const q of queries) {
    try {
      // Add timestamp to vary results
      const searchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(q + ' ' + new Date().getFullYear())}`;
      const res = await fetch(searchUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
      });
      const html = await res.text();
      const allMatches = [...html.matchAll(/"videoId":"([a-zA-Z0-9_-]{11})"/g)].map(m => m[1]);
      const uniqueIds = [...new Set(allMatches)];
      
      // Find first video we haven't used before
      const videoId = uniqueIds.find(id => !existing.videoIds.has(id));
      if (!videoId) continue;
      
      existing.videoIds.add(videoId); // prevent same video in both queries
      
      let title = q;
      let channelName = '';
      const thumbnail = `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;
      try {
        const oembed = await fetchJSON(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`);
        title = oembed.title || q;
        channelName = oembed.author_name || '';
      } catch {}

      const item = {
        type: 'video', title,
        description: channelName ? `By ${channelName}` : '',
        summary: `Top result for "${q}" on YouTube`,
        imageUrl: thumbnail,
        links: [{ label: 'Watch on YouTube', url: `https://www.youtube.com/watch?v=${videoId}` }],
        metadata: { videoId, channelName, viewCount: null, duration: null },
      };
      if (!isDuplicate(item, existing)) items.push(item);
    } catch (e) {
      console.error(`Video generation failed for "${q}":`, e.message);
    }
  }
  return items;
}

async function generateBooks(existing) {
  // Randomize page to get different results each time
  const startIndex = Math.floor(Math.random() * 30);
  const data = await fetchJSON(`https://www.googleapis.com/books/v1/volumes?q=subject:self-help&orderBy=relevance&startIndex=${startIndex}&maxResults=20`);
  const items = [];
  for (const b of (data.items || [])) {
    if (items.length >= 2) break;
    const info = b.volumeInfo || {};
    const title = info.title || 'Untitled';
    if (existing.titles.has(title.toLowerCase().trim())) continue;
    
    const author = (info.authors || ['Unknown'])[0];
    const item = {
      type: 'book',
      title,
      description: info.description || info.subtitle || '',
      summary: info.description || info.subtitle || '',
      imageUrl: info.imageLinks?.thumbnail || null,
      links: [
        ...(info.previewLink ? [{ label: 'Preview on Google Books', url: info.previewLink }] : []),
        ...(info.infoLink ? [{ label: 'More Info', url: info.infoLink }] : []),
      ],
      metadata: { author, quotes: [] },
    };
    if (!isDuplicate(item, existing)) {
      existing.titles.add(title.toLowerCase().trim());
      items.push(item);
    }
  }
  return items;
}

async function generateFashion(existing) {
  const month = new Date().getMonth() + 1;
  const season = month <= 2 || month === 12 ? 'winter' : month <= 5 ? 'spring' : month <= 8 ? 'summer' : 'fall';
  const allTrends = [
    { title: 'Quiet Luxury & Layered Knits', desc: 'Oversized cashmere, tonal layering, and minimalist accessories define this season.' },
    { title: 'Mob Wife Aesthetic', desc: 'Bold fur coats, gold jewelry, dark sunglasses, and unapologetic glamour.' },
    { title: 'Cherry Red Everything', desc: 'From coats to boots, cherry red is the statement color dominating street style.' },
    { title: 'Sheer Fabrics & Pastel Power', desc: 'Translucent layers and soft pastels take center stage.' },
    { title: 'Coastal Grandmother', desc: 'Relaxed linen sets, woven bags, and effortless seaside elegance.' },
    { title: 'Dark Academia', desc: 'Tweed, leather, deep burgundy, and scholarly silhouettes make a comeback.' },
    { title: 'Butter Yellow', desc: 'Soft butter yellow tones in knitwear, blazers, and accessories.' },
    { title: 'Minimalist Tailoring', desc: 'Clean lines, neutral palettes, and perfectly fitted pieces.' },
    { title: 'Boho Revival', desc: 'Flowing skirts, crochet tops, and layered accessories return.' },
    { title: 'Sporty Chic', desc: 'Athletic-inspired pieces mixed with elevated basics for effortless style.' },
  ];
  
  // Find one we haven't used
  for (const trend of allTrends) {
    if (!existing.titles.has(trend.title.toLowerCase().trim())) {
      return [{
        type: 'fashion',
        title: trend.title,
        description: trend.desc,
        summary: `${season} fashion trend`,
        imageUrl: null,
        links: [{ label: 'Explore on Pinterest', url: `https://www.pinterest.com/search/pins/?q=${encodeURIComponent(trend.title)}` }],
        metadata: { source: 'Seasonal curation' },
      }];
    }
  }
  return [];
}

async function generateAITrend(existing) {
  const topIds = await fetchJSON('https://hacker-news.firebaseio.com/v0/topstories.json');
  const aiKeywords = ['ai', 'llm', 'gpt', 'openai', 'anthropic', 'claude', 'gemini', 'machine learning', 'neural', 'transformer'];

  for (const id of topIds.slice(0, 60)) {
    try {
      const story = await fetchJSON(`https://hacker-news.firebaseio.com/v0/item/${id}.json`);
      if (!story || !story.title) continue;
      const titleLower = story.title.toLowerCase();
      const hnUrl = `https://news.ycombinator.com/item?id=${story.id}`;
      
      if (aiKeywords.some(kw => titleLower.includes(kw)) && !existing.urls.has(hnUrl) && !existing.titles.has(story.title.toLowerCase().trim())) {
        return [{
          type: 'ai_trend',
          title: story.title,
          description: story.text ? story.text.replace(/<[^>]+>/g, '').slice(0, 500) : `Trending AI story from Hacker News with ${story.score || 0} points`,
          summary: `HN Score: ${story.score || 0} | ${story.descendants || 0} comments`,
          imageUrl: null,
          links: [
            ...(story.url ? [{ label: 'Read Article', url: story.url }] : []),
            { label: 'HN Discussion', url: hnUrl },
          ],
          metadata: { source: 'Hacker News' },
        }];
      }
    } catch {}
  }
  return [];
}

async function generateHistory(existing) {
  const now = new Date();
  const mm = pad(now.getMonth() + 1);
  const dd = pad(now.getDate());
  const url = `https://en.wikipedia.org/api/rest_v1/feed/onthisday/all/${mm}/${dd}`;
  const data = await fetchJSON(url);

  const events = (data.events || []).sort((a, b) => (b.pages?.length || 0) - (a.pages?.length || 0));
  
  for (const ev of events) {
    const title = `${ev.year}: ${(ev.text || 'Historical Event').slice(0, 100)}`;
    if (existing.titles.has(title.toLowerCase().trim())) continue;
    
    const page = ev.pages?.[0];
    const thumbnail = page?.thumbnail?.source || null;
    const wikiUrl = page?.content_urls?.desktop?.page || (page?.title ? `https://en.wikipedia.org/wiki/${encodeURIComponent(page.title)}` : null);

    return [{
      type: 'history',
      title,
      description: ev.text || '',
      summary: page?.extract || ev.text || '',
      imageUrl: thumbnail,
      links: wikiUrl ? [{ label: 'Read on Wikipedia', url: wikiUrl }] : [],
      metadata: { year: ev.year, wikiUrl },
    }];
  }
  return [];
}

export async function generateMore() {
  console.log('Generating new feed items...');
  const existing = await getExistingKeys();
  const date = todayStr();

  const generators = [
    { name: 'videos', fn: () => generateVideos(existing) },
    { name: 'books', fn: () => generateBooks(existing) },
    { name: 'fashion', fn: () => generateFashion(existing) },
    { name: 'ai_trend', fn: () => generateAITrend(existing) },
    { name: 'history', fn: () => generateHistory(existing) },
  ];

  const newItems = [];
  for (const gen of generators) {
    try {
      const items = await gen.fn();
      for (const item of items) {
        item.date = date;
        item.createdAt = new Date();
      }
      newItems.push(...items);
      console.log(`  ✓ ${gen.name}: ${items.length} items`);
    } catch (e) {
      console.error(`  ✗ ${gen.name} failed:`, e.message);
    }
  }

  if (newItems.length > 0) {
    await FeedItem.insertMany(newItems);
  }

  console.log(`Generated ${newItems.length} new items`);
  return newItems;
}

// CLI
if (process.argv[1]?.endsWith('generate.js')) {
  await connectDB();
  const items = await generateMore();
  console.log(`Done. ${items.length} items created.`);
  process.exit(0);
}
