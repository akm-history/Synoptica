// api/trending.js — Synoptica daily "trending" list (Vercel serverless function)
// ----------------------------------------------------------------------------
// Returns a set of current, significant world events as short search-ready
// phrases for the suggestion chips. Generated at most ONCE PER DAY (cached by
// date) so it's cheap and consistent for everyone, then reused all day.
//
// Independent from the analysis cache in analyze.js: this caches the LIST of
// topics; analyze.js caches each topic's deep-dive. They never collide.
//
// Durable + identical-for-all-visitors requires Upstash (UPSTASH_REDIS_REST_*).
// Without it, the list still refreshes ~daily but is per-instance (may vary).
// ----------------------------------------------------------------------------

// Fallback list — used if generation fails or no API key (UI is never empty).
const FALLBACK = [
  'EU joint defense borrowing and the SAFE facility',
  'US Section 301 forced-labor tariffs on 60 countries',
  'China rare-earth export controls',
  'Undersea cable sabotage in the Baltic',
  "Russia's Africa Corps and the Sahel coups",
  'NATO 5% of GDP defense spending target',
  'Iran nuclear talks and sanctions relief',
  'Critical minerals competition in DR Congo'
];

const KV_URL   = process.env.UPSTASH_REDIS_REST_URL;
const KV_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const kvOn = !!(KV_URL && KV_TOKEN);

// in-memory fallback (per serverless instance)
let _memVal = null, _memDay = null;

async function kvCmd(cmd){
  const r = await fetch(KV_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KV_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(cmd)
  });
  if(!r.ok) throw new Error('kv ' + r.status);
  return (await r.json()).result;
}

function todayKey(){
  return 'trending:' + new Date().toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
}

async function getCached(day){
  if(kvOn){ try { return await kvCmd(['GET', day]); } catch { return null; } }
  return (_memDay === day) ? _memVal : null;
}
async function setCached(day, val){
  if(kvOn){ try { await kvCmd(['SET', day, val, 'EX', '93600']); } catch {} return; } // ~26h
  _memDay = day; _memVal = val;
}

async function generate(){
  if(!process.env.ANTHROPIC_API_KEY) return null;
  const body = {
    model: 'claude-sonnet-4-6',
    max_tokens: 600,
    system: 'You list the most significant CURRENT world events for a geopolitical analysis tool. Use web search to find what is actually in the news right now. Return ONLY a JSON array of 8 short, neutral, search-ready event phrases (4-9 words each) — no numbering, no commentary, no markdown. Mix conflict, trade/economics, defense, tech/surveillance, and resources. Phrases should be specific enough to analyze (e.g. "China rare-earth export controls", not "China news").',
    messages: [{ role: 'user', content: 'List today\'s 8 most significant world events as a JSON array of short search phrases.' }],
    tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 2 }]
  };
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify(body)
    });
    const data = await r.json();
    if(data && data.error) return null;
    const text = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n');
    // extract the JSON array, tolerating preamble/citations
    let t = text.replace(/```(?:json)?/gi, '').replace(/\[\s*\d+(?:\s*,\s*\d+)*\s*\]/g, '');
    const a = t.indexOf('['), b = t.lastIndexOf(']');
    if(a < 0 || b <= a) return null;
    const arr = JSON.parse(t.slice(a, b + 1));
    const clean = arr.filter(x => typeof x === 'string' && x.trim().length > 4).map(x => x.trim()).slice(0, 8);
    return clean.length >= 4 ? clean : null;
  } catch { return null; }
}

export default async function handler(req, res){
  const day = todayKey();

  // 1. serve today's cached list if present
  try {
    const hit = await getCached(day);
    if(hit){ res.status(200).json({ date: day, topics: JSON.parse(hit), cached: true }); return; }
  } catch { /* fall through to generate */ }

  // 2. generate today's list (one Claude call w/ search), cache it
  const topics = await generate();
  if(topics){
    await setCached(day, JSON.stringify(topics));
    res.status(200).json({ date: day, topics, cached: false });
    return;
  }

  // 3. fallback — never leave the UI empty
  res.status(200).json({ date: day, topics: FALLBACK, cached: false, fallback: true });
}
