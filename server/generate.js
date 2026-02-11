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

async function searchYouTube(query) {
  // Try multiple Invidious instances (public, no API key needed, works from servers)
  const instances = [
    'https://vid.puffyan.us',
    'https://invidious.fdn.fr',
    'https://y.com.sb',
    'https://invidious.nerdvpn.de',
  ];
  
  for (const instance of instances) {
    try {
      const url = `${instance}/api/v1/search?q=${encodeURIComponent(query)}&type=video&sort_by=relevance`;
      const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) continue;
      const results = await res.json();
      return (results || []).filter(r => r.type === 'video').map(r => ({
        videoId: r.videoId,
        title: r.title,
        channelName: r.author || '',
        description: r.description || '',
        viewCount: r.viewCount || null,
        lengthSeconds: r.lengthSeconds || null,
      }));
    } catch {
      continue;
    }
  }

  // Fallback: scrape YouTube directly
  try {
    const searchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
    const res = await fetch(searchUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
    });
    const html = await res.text();
    const allMatches = [...html.matchAll(/"videoId":"([a-zA-Z0-9_-]{11})"/g)].map(m => m[1]);
    return [...new Set(allMatches)].map(id => ({ videoId: id, title: null, channelName: '', description: '' }));
  } catch {
    return [];
  }
}

async function generateVideos(existing) {
  // Vary the search queries for freshness
  const salsaVariants = ['salsa dancing', 'best salsa dance', 'salsa performance', 'salsa bachata dance', 'latin dance salsa'];
  const guitarVariants = ['acoustic guitar cover', 'guitar cover popular song', 'acoustic cover song', 'fingerstyle guitar cover', 'unplugged guitar cover'];
  
  const salsaQuery = salsaVariants[Math.floor(Math.random() * salsaVariants.length)];
  const guitarQuery = guitarVariants[Math.floor(Math.random() * guitarVariants.length)];
  const queries = [salsaQuery, guitarQuery];
  
  const items = [];
  for (const q of queries) {
    try {
      const results = await searchYouTube(q);
      
      // Find first video we haven't used before
      const match = results.find(r => r.videoId && !existing.videoIds.has(r.videoId));
      if (!match) {
        console.log(`  No new videos found for "${q}" (${results.length} results, all seen)`);
        continue;
      }
      
      const { videoId } = match;
      existing.videoIds.add(videoId);
      
      let title = match.title || q;
      let channelName = match.channelName || '';
      const thumbnail = `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;
      
      // If we didn't get title from Invidious, try oEmbed
      if (!match.title) {
        try {
          const oembed = await fetchJSON(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`);
          title = oembed.title || q;
          channelName = oembed.author_name || channelName;
        } catch {}
      }

      const desc = match.description || (channelName ? `By ${channelName}` : '');
      const item = {
        type: 'video', title,
        description: desc,
        summary: channelName ? `${channelName} — found via "${q}"` : `Found via "${q}"`,
        imageUrl: thumbnail,
        links: [{ label: 'Watch on YouTube', url: `https://www.youtube.com/watch?v=${videoId}` }],
        metadata: { videoId, channelName, viewCount: match.viewCount, duration: match.lengthSeconds },
      };
      if (!isDuplicate(item, existing)) items.push(item);
    } catch (e) {
      console.error(`Video generation failed for "${q}":`, e.message);
    }
  }
  return items;
}

const CURATED_BOOKS = [
  {
    title: 'Atomic Habits',
    author: 'James Clear',
    description: 'A revolutionary system for getting 1% better every day. James Clear reveals practical strategies for forming good habits, breaking bad ones, and mastering the tiny behaviors that lead to remarkable results. The book draws on proven ideas from biology, psychology, and neuroscience to create an easy-to-understand guide for making good habits inevitable and bad habits impossible.',
    quotes: ['You do not rise to the level of your goals. You fall to the level of your systems.', 'Every action you take is a vote for the type of person you wish to become.', 'The most effective way to change your habits is to focus not on what you want to achieve, but on who you wish to become.'],
    link: 'https://jamesclear.com/atomic-habits',
  },
  {
    title: 'The Subtle Art of Not Giving a F*ck',
    author: 'Mark Manson',
    description: 'A counterintuitive approach to living a good life. Mark Manson argues that improving our lives hinges not on our ability to turn lemons into lemonade, but on learning to stomach lemons better. He advises us to get to know our limitations and accept them, because once we embrace our fears, faults, and uncertainties — we can begin to find the courage and confidence we desperately seek.',
    quotes: ['Who you are is defined by what you\'re willing to struggle for.', 'The desire for more positive experience is itself a negative experience. And, paradoxically, the acceptance of one\'s negative experience is itself a positive experience.', 'You are already choosing, in every moment of every day, what to give a f*ck about.'],
    link: 'https://markmanson.net/books/subtle-art',
  },
  {
    title: 'Think Again',
    author: 'Adam Grant',
    description: 'Adam Grant examines the critical art of rethinking — the ability to question your opinions and open other people\'s minds. He shows how we can embrace the joy of being wrong, bring nuance to charged conversations, and build schools and workplaces that prize rethinking over proving. Intelligence is usually seen as the ability to think and learn, but in a rapidly changing world, there\'s another set of cognitive skills that matters more: the ability to rethink and unlearn.',
    quotes: ['The purpose of learning isn\'t to affirm our beliefs; it\'s to evolve our beliefs.', 'We listen to views that make us feel good, instead of ideas that make us think hard.', 'Being wrong is the only way I feel sure I\'ve learned something.'],
    link: 'https://adamgrant.net/book/think-again/',
  },
  {
    title: 'The 7 Habits of Highly Effective People',
    author: 'Stephen R. Covey',
    description: 'One of the most inspiring and impactful books ever written. Stephen Covey presents a holistic, integrated, principle-centered approach for solving personal and professional problems. With penetrating insights and practical anecdotes, Covey reveals a step-by-step pathway for living with fairness, integrity, honesty, and human dignity — principles that give us the security to adapt to change and the wisdom to take advantage of opportunities.',
    quotes: ['Begin with the end in mind.', 'Most people do not listen with the intent to understand; they listen with the intent to reply.', 'The main thing is to keep the main thing the main thing.'],
    link: 'https://www.franklincovey.com/the-7-habits/',
  },
  {
    title: 'Thinking, Fast and Slow',
    author: 'Daniel Kahneman',
    description: 'Nobel laureate Daniel Kahneman takes us on a groundbreaking tour of the mind and explains the two systems that drive the way we think. System 1 is fast, intuitive, and emotional; System 2 is slower, more deliberative, and more logical. Kahneman exposes the extraordinary capabilities — and also the faults and biases — of fast thinking, and reveals the pervasive influence of intuitive impressions on our thoughts and behavior.',
    quotes: ['Nothing in life is as important as you think it is, while you are thinking about it.', 'A reliable way to make people believe in falsehoods is frequent repetition, because familiarity is not easily distinguished from truth.', 'We can be blind to the obvious, and we are also blind to our blindness.'],
    link: 'https://en.wikipedia.org/wiki/Thinking,_Fast_and_Slow',
  },
  {
    title: 'Can\'t Hurt Me',
    author: 'David Goggins',
    description: 'David Goggins shares his astonishing life story and reveals that most of us tap into only 40% of our capabilities. Goggins calls this The 40% Rule, and his story illuminates a path that anyone can follow to push past pain, demolish fear, and reach their full potential. From growing up abused and poor to becoming a Navy SEAL, ultra-endurance athlete, and one of the world\'s fittest men, Goggins\' raw honesty about what it takes to master the mind is unforgettable.',
    quotes: ['You are in danger of living a life so comfortable and soft that you will die without ever realizing your potential.', 'The most important conversations you\'ll ever have are the ones you\'ll have with yourself.', 'Don\'t stop when you\'re tired. Stop when you\'re done.'],
    link: 'https://davidgoggins.com/',
  },
  {
    title: 'The Power of Now',
    author: 'Eckhart Tolle',
    description: 'A guide to spiritual enlightenment that has sold millions of copies worldwide. Eckhart Tolle shows readers how to quiet their mind, live fully in the present, and free themselves from the trap of overthinking. Much of our suffering comes from dwelling on the past or worrying about the future — Tolle offers a simple yet profound path to finding peace in the present moment.',
    quotes: ['Realize deeply that the present moment is all you have. Make the NOW the primary focus of your life.', 'The primary cause of unhappiness is never the situation but your thoughts about it.', 'Life is the dancer and you are the dance.'],
    link: 'https://eckharttolle.com/the-power-of-now/',
  },
  {
    title: 'Mindset: The New Psychology of Success',
    author: 'Carol S. Dweck',
    description: 'Stanford psychologist Carol Dweck\'s brilliant discovery of fixed and growth mindsets has shaped education, sports, and business. She shows how success in school, work, sports, the arts, and almost every area of human endeavor can be dramatically influenced by how we think about our talents and abilities. People with a fixed mindset believe talent alone creates success. People with a growth mindset believe that effort and learning create success — and they\'re right.',
    quotes: ['Becoming is better than being.', 'The view you adopt for yourself profoundly affects the way you lead your life.', 'No matter what your ability is, effort is what ignites that ability and turns it into accomplishment.'],
    link: 'https://www.mindsetworks.com/',
  },
  {
    title: 'Deep Work',
    author: 'Cal Newport',
    description: 'Cal Newport argues that the ability to perform deep work — focusing without distraction on a cognitively demanding task — is becoming increasingly rare and increasingly valuable in our economy. He presents a rigorous training regimen for developing a deep work practice, and demonstrates that deep work is the superpower of the 21st century. The few who cultivate this skill will thrive.',
    quotes: ['If you don\'t produce, you won\'t thrive — no matter how skilled or talented you are.', 'Clarity about what matters provides clarity about what does not.', 'To simply wait and be bored has become a novel experience in modern life, but from the perspective of concentration training, it\'s incredibly valuable.'],
    link: 'https://www.calnewport.com/books/deep-work/',
  },
  {
    title: 'The Four Agreements',
    author: 'Don Miguel Ruiz',
    description: 'Based on ancient Toltec wisdom, Don Miguel Ruiz offers a powerful code of conduct that can rapidly transform our lives to a new experience of freedom, true happiness, and love. The four agreements are: Be impeccable with your word. Don\'t take anything personally. Don\'t make assumptions. Always do your best. These seemingly simple agreements are deceptively powerful and have helped millions of people worldwide.',
    quotes: ['Don\'t take anything personally. Nothing others do is because of you.', 'Be impeccable with your word. Speak with integrity.', 'Find the courage to ask questions and to express what you really want.'],
    link: 'https://www.miguelruiz.com/',
  },
  {
    title: 'Man\'s Search for Meaning',
    author: 'Viktor E. Frankl',
    description: 'Psychiatrist Viktor Frankl\'s memoir of surviving the Nazi death camps reveals the profound lesson that even in the most absurd, painful, and dehumanized situation, life has potential meaning and therefore even suffering has meaning. Frankl\'s theory — logotherapy — holds that our primary drive in life is not pleasure but the discovery and pursuit of what we personally find meaningful. One of the most influential books of the 20th century.',
    quotes: ['When we are no longer able to change a situation, we are challenged to change ourselves.', 'Everything can be taken from a man but one thing: the last of the human freedoms — to choose one\'s attitude in any given set of circumstances.', 'Those who have a \'why\' to live, can bear with almost any \'how\'.'],
    link: 'https://en.wikipedia.org/wiki/Man%27s_Search_for_Meaning',
  },
  {
    title: '12 Rules for Life',
    author: 'Jordan B. Peterson',
    description: 'Clinical psychologist Jordan Peterson offers 12 practical and profound rules for life, drawing on science, philosophy, religion, and personal experience. Humorous, surprising, and informative, the book tells us why skateboarding boys and girls must be left alone, what terrible fate awaits those who criticize too easily, and why you should always pet a cat when you encounter one on the street.',
    quotes: ['Compare yourself to who you were yesterday, not to who someone else is today.', 'To stand up straight with your shoulders back is to accept the terrible responsibility of life, with eyes wide open.', 'If you can\'t even clean up your own room, who the hell are you to give advice to the world?'],
    link: 'https://www.jordanbpeterson.com/12-rules-for-life/',
  },
  {
    title: 'Grit',
    author: 'Angela Duckworth',
    description: 'MacArthur "genius" Angela Duckworth shows anyone striving to succeed that the secret to outstanding achievement is not talent but a special blend of passion and persistence she calls "grit." Drawing on her own powerful story, Duckworth argues that the real predictor of success is not IQ or talent, but the combination of passion and long-term perseverance. Grit can be learned, and Duckworth shows you how.',
    quotes: ['Enthusiasm is common. Endurance is rare.', 'Our potential is one thing. What we do with it is quite another.', 'Grit is living life like it\'s a marathon, not a sprint.'],
    link: 'https://angeladuckworth.com/grit-book/',
  },
  {
    title: 'The Alchemist',
    author: 'Paulo Coelho',
    description: 'Paulo Coelho\'s masterwork tells the mystical story of Santiago, an Andalusian shepherd boy who yearns to travel in search of a worldly treasure. His quest will lead him to riches far different — and far more satisfying — than he ever imagined. A transformative tale about the essential wisdom of listening to our hearts, recognizing opportunity, and following our dreams.',
    quotes: ['When you want something, all the universe conspires in helping you to achieve it.', 'It\'s the possibility of having a dream come true that makes life interesting.', 'People are capable, at any time in their lives, of doing what they dream of.'],
    link: 'https://paulocoelhoblog.com/the-alchemist/',
  },
  {
    title: 'Daring Greatly',
    author: 'Brené Brown',
    description: 'Researcher Brené Brown challenges everything we think we know about vulnerability. Based on twelve years of research, she argues that vulnerability is not weakness but rather our most accurate measure of courage. She dispels the cultural myth that vulnerability is a flaw and reveals that it is our clearest path to courage, engagement, and meaningful connection.',
    quotes: ['Vulnerability is not winning or losing; it\'s having the courage to show up and be seen when we have no control over the outcome.', 'Courage starts with showing up and letting ourselves be seen.', 'What we know matters but who we are matters more.'],
    link: 'https://brenebrown.com/book/daring-greatly/',
  },
  {
    title: 'The Happiness Project',
    author: 'Gretchen Rubin',
    description: 'Gretchen Rubin chronicles her year-long adventure trying every principle, tip, theory, and scientific study she could find about how to become happier. Each month she tackles a new set of resolutions — from boosting energy to improving relationships. Rubin discovers that money can help buy happiness when spent wisely, that novelty and challenge are powerful sources of happiness, and that the days are long but the years are short.',
    quotes: ['The days are long, but the years are short.', 'One of the best ways to make yourself happy is to make other people happy. One of the best ways to make other people happy is to be happy yourself.', 'What you do every day matters more than what you do once in a while.'],
    link: 'https://gretchenrubin.com/books/the-happiness-project/',
  },
  {
    title: 'Outliers',
    author: 'Malcolm Gladwell',
    description: 'Malcolm Gladwell takes us on an intellectual journey through the world of "outliers" — the best and the brightest, the most famous and the most successful. He asks the question: what makes high-achievers different? His answer is that we pay too much attention to what successful people are like, and too little attention to where they are from: their culture, family, generation, and the idiosyncratic experiences of their upbringing.',
    quotes: ['It\'s not how much money we make that ultimately makes us happy between nine and five. It\'s whether or not our work fulfills us.', 'Practice isn\'t the thing you do once you\'re good. It\'s the thing you do that makes you good.', 'Success is not a random act. It arises out of a predictable and powerful set of circumstances and opportunities.'],
    link: 'https://www.gladwellbooks.com/titles/malcolm-gladwell/outliers/',
  },
  {
    title: 'Ikigai: The Japanese Secret to a Long and Happy Life',
    author: 'Héctor García & Francesc Miralles',
    description: 'The people of Japan believe that everyone has an ikigai — a reason to jump out of bed each morning. The authors traveled to Okinawa, the island with the most centenarians in the world, to discover the secrets of longevity and happiness. They reveal that ikigai lies at the intersection of what you love, what you\'re good at, what the world needs, and what you can be paid for.',
    quotes: ['Only staying active will make you want to live a hundred years.', 'There is a tension between what is good for someone and what they want to do. This is because people, especially older people, like to do what they\'ve always done.', 'We don\'t create the meaning of our life. We discover it.'],
    link: 'https://en.wikipedia.org/wiki/Ikigai',
  },
  {
    title: 'The Mountain Is You',
    author: 'Brianna Wiest',
    description: 'Brianna Wiest explores the concept of self-sabotage — why we do it, how to recognize it, and how to overcome it. She explains that sometimes the mountain we need to climb is ourselves: the emotional habits, limiting beliefs, and past experiences that hold us back. This book is a guide to realizing that the obstacle in your path is actually the key to your evolution.',
    quotes: ['Your new life is going to cost you your old one.', 'The mountain is you because it was built from everything you\'ve been avoiding.', 'You must learn the art of being a witness to your own life.'],
    link: 'https://briannawiest.com/the-mountain-is-you/',
  },
  {
    title: 'Range: Why Generalists Triumph in a Specialized World',
    author: 'David Epstein',
    description: 'David Epstein makes the case that in most fields — especially those that are complex and unpredictable — generalists, not specialists, are primed to excel. He shows that breadth of experience is often the key to creativity and innovation, and that late bloomers and career-switchers often outperform early specialists. A powerful argument for embracing diverse interests.',
    quotes: ['The challenge we all face is how to maintain the benefits of breadth, diverse experience, interdisciplinary thinking, and delayed concentration in a world that increasingly incentivizes, even demands, hyperspecialization.', 'Struggling to generate an answer on your own, even a wrong one, enhances subsequent learning.'],
    link: 'https://davidepstein.com/the-range/',
  },
];

// Shuffle array helper
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

async function generateBooks(existing) {
  const items = [];
  
  // Try NYT bestsellers first (no API key needed for the books page)
  try {
    const nytUrl = 'https://www.googleapis.com/books/v1/volumes?q=self+help+bestseller+2025&orderBy=relevance&maxResults=10';
    const data = await fetchJSON(nytUrl);
    for (const b of (data.items || [])) {
      if (items.length >= 1) break;
      const info = b.volumeInfo || {};
      const title = info.title || '';
      if (!title || existing.titles.has(title.toLowerCase().trim())) continue;
      if (!info.description || info.description.length < 50) continue;
      
      const author = (info.authors || ['Unknown'])[0];
      const item = {
        type: 'book', title,
        description: info.description,
        summary: info.description,
        imageUrl: null,
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
  } catch (e) {
    console.error('Google Books API failed:', e.message);
  }

  // Fill remaining slots from curated list (shuffled for variety)
  const needed = 2 - items.length;
  if (needed > 0) {
    const shuffled = shuffle(CURATED_BOOKS);
    for (const book of shuffled) {
      if (items.length >= 2) break;
      if (existing.titles.has(book.title.toLowerCase().trim())) continue;
      
      existing.titles.add(book.title.toLowerCase().trim());
      items.push({
        type: 'book',
        title: book.title,
        description: book.description,
        summary: book.description,
        imageUrl: null,
        links: [{ label: 'Learn More', url: book.link }],
        metadata: { author: book.author, quotes: book.quotes },
      });
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
    const title = `${ev.year}: ${ev.text || 'Historical Event'}`;
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
