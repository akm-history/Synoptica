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

// Fallback set — used if generation fails or no API key (UI is never empty).
// Keys MUST match the category tab names in the frontend.
const FALLBACK = {
  'Trending now': [
    'EU joint defense borrowing and the SAFE facility',
    'US Section 301 forced-labor tariffs on 60 countries',
    'China rare-earth export controls',
    'Undersea cable sabotage in the Baltic',
    "Russia's Africa Corps and the Sahel coups"
  ],
  'Conflict & defense': [
    'NATO 5% of GDP defense spending target',
    'EU joint defense borrowing and the SAFE facility',
    'Ukraine long-range strike policy shifts',
    'Iran nuclear talks and sanctions relief'
  ],
  'Trade & tariffs': [
    'US Section 301 forced-labor tariffs on 60 countries',
    'EU-China EV tariff dispute',
    'USMCA renegotiation pressures',
    'Semiconductor export-control escalation'
  ],
  'Debt & capital': [
    'Argentina IMF program under Milei',
    'African sovereign debt distress and the IMF',
    'China overseas lending slowdown',
    'Global bond market volatility'
  ],
  'Surveillance & tech': [
    'UK Online Safety Act enforcement',
    'EU AI Act implementation',
    'AI chip export controls and Nvidia',
    'Undersea cable security and sabotage'
  ],
  'Resources & minerals': [
    'China rare-earth export controls',
    'Critical minerals competition in DR Congo',
    'Lithium nationalization in Latin America',
    'Gulf states and the global energy transition'
  ]
};
const CATEGORY_NAMES = Object.keys(FALLBACK);

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
  const cats = CATEGORY_NAMES.join('", "');
  const body = {
    model: 'claude-sonnet-4-6',
    max_tokens: 1400,
    system: 'You curate CURRENT-events suggestion lists for a geopolitical analysis tool. Use web search to find what is actually in the news right now. Return ONLY a JSON object whose keys are EXACTLY these categories: "'+cats+'". Each value is an array of 4-5 short, neutral, search-ready event phrases (4-9 words each) reflecting what is currently happening in that category. "Trending now" = the most significant overall stories right now across all categories. Phrases must be specific enough to analyze (e.g. "China rare-earth export controls", not "China news"). No numbering, no commentary, no markdown, no citations — just the JSON object.',
    messages: [{ role: 'user', content: 'Build today\'s suggestion lists for each category as a single JSON object.' }],
    tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 3 }]
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
    let t = text.replace(/```(?:json)?/gi, '').replace(/\[\s*\d+(?:\s*,\s*\d+)*\s*\]/g, '');
    const a = t.indexOf('{'), b = t.lastIndexOf('}');
    if(a < 0 || b <= a) return null;
    const obj = JSON.parse(t.slice(a, b + 1));
    // keep only known categories with valid non-empty string arrays; fall back per-category
    const out = {};
    for(const name of CATEGORY_NAMES){
      const arr = Array.isArray(obj[name]) ? obj[name].filter(x => typeof x === 'string' && x.trim().length > 4).map(x => x.trim()).slice(0, 5) : [];
      out[name] = arr.length >= 3 ? arr : FALLBACK[name];
    }
    return out;
  } catch { return null; }
}

export default async function handler(req, res){
  const day = todayKey();

  // 1. serve today's cached set if present
  try {
    const hit = await getCached(day);
    if(hit){
      const categories = JSON.parse(hit);
      res.status(200).json({ date: day, categories, topics: categories['Trending now'], cached: true });
      return;
    }
  } catch { /* fall through to generate */ }

  // 2. generate today's full set (ONE Claude call w/ search for all categories), cache it
  const categories = await generate();
  if(categories){
    await setCached(day, JSON.stringify(categories));
    res.status(200).json({ date: day, categories, topics: categories['Trending now'], cached: false });
    return;
  }

  // 3. fallback — never leave the UI empty
  res.status(200).json({ date: day, categories: FALLBACK, topics: FALLBACK['Trending now'], cached: false, fallback: true });
}
