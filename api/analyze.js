// api/analyze.js — Synoptica backend (Vercel serverless function)
// ----------------------------------------------------------------------------
// This is the ONLY place your Anthropic API key lives. It never reaches the
// browser. The front end sends {query, mode, useSearch}; this function builds
// the full Claude request (owning the search cap so a user can't inflate cost),
// applies rate limiting + caching, calls Claude, and returns {text, links}.
//
// Works out of the box with in-memory rate-limit/cache (fine for you + friends).
// Add UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN env vars to upgrade to
// durable, cross-instance rate-limiting and caching — no code change needed.
// ----------------------------------------------------------------------------

const SYSTEM = `You are a rigorous geopolitical-economy analyst. A user gives you a world event. You analyze it through four "complex" lenses and return a structured deep-dive.

SEARCH STRATEGY — when grounding with web search, do NOT run a single generic search. Run several DISTINCT searches from different angles, then synthesize across all of them:
1. The core event — latest verified facts, dates, figures.
2. The OPPOSING / critical case — who objects and why; risks, downsides, dissenting analysis.
3. The money trail — who profits, capital flows, contracts, financial winners and losers.
4. NON-WESTERN / regional coverage — deliberately seek how outlets outside the US/UK frame it (e.g. regional, Global South, or local-language sources in translation), to counter the default Western-source skew.
Pull from a SPREAD of source types: official/primary data, mainstream journalism, and at least one non-Western outlet where relevant. If sources conflict, say so rather than averaging them away.

The four lenses (apply only those that genuinely fit; you may use 2-4):
- FIC = Financial-Industrial Complex (capital flows, debt vs equity, conditionality, who profits financially)
- MIC = Military-Industrial Complex (defense spending, contracts, theater shifts, who arms whom)
- TIC = Technology-Industrial Complex (surveillance, data, platform power, dual-use tech)
- GEO = State power / diplomacy (alliances, leverage, sovereignty, regional balance)

DEPTH REQUIREMENTS — this is what separates a real analysis from a summary. Every section must clear these bars:

- SPECIFIC, NOT GENERIC. Never write "this could affect markets/spending." Name the concrete channel, the actor, and a figure: which company, which budget line, which country, which number to watch, and roughly how big. "Pushes German air-defense procurement, so Rheinmetall's order backlog is the tell" — not "affects defense."
- EXPLAIN, DON'T RESTATE. Don't just say what happened. Answer who / what / when / where — and then the hard ones: WHY it happened, HOW the mechanism actually works, and especially WHY NOW (the specific trigger or deadline that made it happen at this moment rather than a year ago or a year from now).
- HISTORY AS A CAUSAL CHAIN. The history must be a throughline, not a date list. Each step should make the NEXT one possible — show the causal link ("X removed the obstacle to Y", "Z created the incentive for…"). If two events are merely adjacent in time with no causal link, don't imply one.
- REAL TENSION, NOT BOTH-SIDES-ISM. For perspectives, give each side's STRONGEST good-faith case (steelman, never strawman) AND identify the single empirical question they actually disagree about — the "crux" — the thing where, if you knew the answer, one side would be right. Not "they have different values" but "they disagree about whether X will actually cause Y."
- DOCUMENTED vs INFERRED. Mark which claims are documented (official statement, filing, hard data) versus inferred (your reading of incentives). Confidence ratings must reflect this: High = documented; Guarded = reasonable inference; Speculative = plausible but thin. The caveat must state plainly what evidence would prove the dominant reading WRONG.
- METRIC DISCIPLINE — label every number with WHAT it measures, and never conflate different metrics. Share price, market cap, and total shareholder return are NOT revenue; revenue is NOT profit; order backlog is NOT sales; a percentage change is NOT a level. These move at wildly different magnitudes — a defense firm's stock can rise 300% while its revenue rises 70%, so calling a stock move "revenue growth" is a serious error. State the metric, the unit, the period, and the base year for any figure (e.g. "revenue rose from €5.7bn (2021) to €9.9bn (2025), +75%"). When citing a growth figure, be explicit whether it is an aggregate/total across firms or a single firm, and whether it is a simple average or weighted — mixing per-firm extremes with a group average produces contradictions. If you are not confident a number is the metric you're claiming, say so or omit it rather than guess.
- CHRONOLOGY CLARITY — never let a timeline jump be ambiguous. When events span more than one calendar year, restate the YEAR at every step (don't write "April 12" when a later item is in a different year). A semicolon or "then" must never carry a multi-month or cross-year leap — make the gap explicit ("...collapsed in June 2025. A year later, in June 2026, ..."). If significant time or a major intervening event (e.g. a war) falls between two steps, say so rather than eliding it.
- DEAL FRAGILITY / SPOILER RISK — when the event is a deal, ceasefire, MOU, treaty, or negotiation, you MUST assess how durable it is, not just describe it. Name the specific actors with the incentive AND capability to break it; cite their TRACK RECORD as documented fact (prior breaches, strikes, stated intentions, occupied territory) with attribution; and state what would actually cause collapse. Then give the counter-position fairly (why those actors say their conduct is justified or why the deal may hold). Report contested legal characterizations (e.g. "war crimes", "aggression") only as ATTRIBUTED allegations by named bodies or parties — never as the engine's own asserted fact. The point is a sourced, verifiable fragility assessment a skeptical reader of any persuasion will trust — strong facts with attribution, not loaded adjectives.

The four lenses (apply only those that genuinely fit; you may use 2-4):
- FIC = Financial-Industrial Complex (capital flows, debt vs equity, conditionality, who profits financially)
- MIC = Military-Industrial Complex (defense spending, contracts, theater shifts, who arms whom)
- TIC = Technology-Industrial Complex (surveillance, data, platform power, dual-use tech)
- GEO = State power / diplomacy (alliances, leverage, sovereignty, regional balance)

EPISTEMIC RULES — follow strictly:
- Favor OPPORTUNISM over COORDINATION. Institutions follow openings; do not assert secret central planning.
- No conspiracy theories. Confirmed strategy stated by officials or reported by credible outlets is fine; manufactured-pretext claims must be flagged Speculative.
- Note where coverage conflicts across regions or where one side's framing dominates the available sources.

Use web search to ground current facts. Then respond with ONLY a JSON object (no markdown, no preamble, no code fences, no citation brackets like [1], no text before or after the object) in EXACTLY this shape:
{
 "event":"normalized short title",
 "summary":"1-2 neutral sentences on what happened (who/what/when/where)",
 "whyNow":"the specific trigger, deadline, or change that made this happen at THIS moment — 1-2 sentences naming the precipitating cause",
 "lenses":[{"code":"FIC|MIC|TIC|GEO","name":"short lens name for this event","confidence":"High|Guarded|Speculative","reading":"2-4 sentences naming the concrete mechanism, the actor(s), and a figure/number where possible","indicators":["specific number or event to watch","another"]}],
 "perspectives":{"crux":"the single empirical question the two sides actually disagree about — if answered, one side is right","proponents":[{"who":"specific actor category","argument":"their strongest case with a concrete reason, 1-2 sentences"}],"critics":[{"who":"specific actor category","argument":"their strongest objection with a concrete reason, 1-2 sentences"}]},
 "history":[{"date":"approx date or period","text":"what happened AND what it caused/enabled next — show the causal link"}],
 "fragility":{"verdict":"how durable, e.g. 'Highly fragile' / 'Holding but contested' / 'N/A — not a deal'","spoilers":[{"actor":"who can break it","why":"their incentive + documented track record, with attribution","capability":"what they can actually do"}],"collapseTrigger":"the specific event that would most likely cause collapse","counterview":"why it might hold, or why a named spoiler says its conduct is justified"},
 "connected":[{"event":"related event","link":"the specific causal or structural connection, not just 'related'"}],
 "outcomes":[{"scenario":"plausible future with its mechanism","likelihood":"more likely|even|less likely","watch":"the specific signal that would confirm this path"}],
 "sources":["primary sources to verify against, e.g. SIPRI, IMF WEO, World Bank IDS, AidData, USAspending.gov, official filings"],
 "caveat":"the key uncertainty, and PLAINLY what evidence would prove the dominant reading wrong"
}
Aim for 2-3 lenses, 4-6 history items forming a clear chain, 2-3 connected, 2-3 outcomes. Include "fragility" ONLY when the event is a deal/ceasefire/treaty/negotiation; otherwise set fragility to null. Be dense and specific rather than long-winded — every sentence should carry a fact, a mechanism, or a number.`;

// ---- config (override via Vercel env vars) ----
const MAX_SEARCHES   = parseInt(process.env.MAX_SEARCHES   || '8', 10);  // hard ceiling on web searches per query
const RATE_PER_HOUR  = parseInt(process.env.RATE_PER_HOUR  || '20', 10); // searches allowed per IP per hour
const CACHE_TTL_SECS = parseInt(process.env.CACHE_TTL_SECS || '21600', 10); // 6h
const MAX_QUERY_LEN  = 300;

// ---- tiny KV layer: Upstash Redis REST if configured, else in-memory ----
const KV_URL   = process.env.UPSTASH_REDIS_REST_URL;
const KV_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const kvOn = !!(KV_URL && KV_TOKEN);

const _mem = new Map();            // in-memory fallback store
const _memExp = new Map();         // expiry timestamps

async function kvCmd(cmd){
  const r = await fetch(KV_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KV_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(cmd)
  });
  if(!r.ok) throw new Error('kv ' + r.status);
  return (await r.json()).result;
}
async function kvGet(key){
  if(kvOn){ try { return await kvCmd(['GET', key]); } catch { return null; } }
  const exp = _memExp.get(key);
  if(exp && Date.now() > exp){ _mem.delete(key); _memExp.delete(key); return null; }
  return _mem.has(key) ? _mem.get(key) : null;
}
async function kvSet(key, val, ttl){
  if(kvOn){ try { await kvCmd(['SET', key, val, 'EX', String(ttl)]); } catch {} return; }
  _mem.set(key, val); _memExp.set(key, Date.now() + ttl*1000);
}
async function kvIncrTtl(key, ttl){
  if(kvOn){
    try {
      const n = await kvCmd(['INCR', key]);
      if(n === 1) await kvCmd(['EXPIRE', key, String(ttl)]);
      return n;
    } catch { return 1; } // fail open on KV error
  }
  const exp = _memExp.get(key);
  if(exp && Date.now() > exp){ _mem.delete(key); _memExp.delete(key); }
  const n = (_mem.get(key) || 0) + 1;
  _mem.set(key, n);
  if(n === 1) _memExp.set(key, Date.now() + ttl*1000);
  return n;
}

// ---- helpers ----
function clientIp(req){
  const xf = req.headers['x-forwarded-for'];
  return (xf ? String(xf).split(',')[0].trim() : (req.socket?.remoteAddress || 'unknown'));
}
function hostOf(u){ try { return new URL(u).hostname.replace(/^www\./,''); } catch { return u; } }
function collectLinks(blocks){
  const map = new Map();
  const add = (url, title) => {
    if(!url || !/^https?:\/\//i.test(url)) return;
    if(!map.has(url)) map.set(url, { url, title: title || hostOf(url) });
  };
  for(const b of blocks){
    if(b.type === 'web_search_tool_result' && Array.isArray(b.content)) b.content.forEach(r => add(r.url, r.title));
    if(b.type === 'text' && Array.isArray(b.citations)) b.citations.forEach(c => add(c.url, c.title));
  }
  return Array.from(map.values()).slice(0, 12);
}

// ---- the handler ----
export default async function handler(req, res){
  if(req.method !== 'POST'){ res.status(405).json({ error: 'POST only' }); return; }
  if(!process.env.ANTHROPIC_API_KEY){ res.status(500).json({ error: 'Server missing ANTHROPIC_API_KEY' }); return; }

  // --- validate input ---
  let { query, mode, useSearch } = req.body || {};
  query = (typeof query === 'string' ? query.trim() : '');
  if(!query || query.length < 2){ res.status(400).json({ error: 'Empty query' }); return; }
  if(query.length > MAX_QUERY_LEN) query = query.slice(0, MAX_QUERY_LEN);
  const quick = (mode === 'quick');
  useSearch = (useSearch !== false);

  // --- rate limit (per IP per hour) ---
  try {
    const ip = clientIp(req);
    const bucket = Math.floor(Date.now() / 3600000);
    const count = await kvIncrTtl(`rl:${ip}:${bucket}`, 3600);
    if(count > RATE_PER_HOUR){ res.status(429).json({ error: 'Rate limit reached. Try again later.' }); return; }
  } catch { /* fail open — never block on limiter errors */ }

  // --- cache (only grounded results are worth caching) ---
  const cacheKey = `cache:${quick ? 'q' : 'd'}:${query.toLowerCase().replace(/\s+/g, ' ')}`;
  if(useSearch){
    try {
      const hit = await kvGet(cacheKey);
      if(hit){ const obj = JSON.parse(hit); obj.cached = true; res.status(200).json(obj); return; }
    } catch { /* ignore cache read errors */ }
  }

  // --- build the Claude request (server owns the search cap) ---
  let maxUses = quick ? 2 : 8;
  maxUses = Math.min(maxUses, MAX_SEARCHES);
  const body = {
    model: 'claude-sonnet-4-6',
    max_tokens: quick ? 2200 : 6000,
    system: SYSTEM,
    messages: [{ role: 'user', content:
      'Event to analyze: ' + query +
      (quick ? '\n\nQUICK READ MODE: be fast and concise. Run at most 2 searches. Return summary, whyNow, the 2 most relevant lenses, the perspectives crux with one proponent and one critic, 3 history items, and top sources. Omit connected/outcomes or keep to one each. Same JSON shape, just lighter.' : '')
    }]
  };
  if(useSearch) body.tools = [{ type: 'web_search_20250305', name: 'web_search', max_uses: maxUses }];

  // --- call Claude ---
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
    if(data && data.error){ res.status(502).json({ error: data.error.message || 'Upstream error' }); return; }
    const blocks = data.content || [];
    const text = blocks.filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
    if(!text){ res.status(502).json({ error: 'Empty response from model' }); return; }

    const out = { text, links: collectLinks(blocks), cached: false };
    if(useSearch){ try { await kvSet(cacheKey, JSON.stringify({ text: out.text, links: out.links }), CACHE_TTL_SECS); } catch {} }
    res.status(200).json(out);
  } catch (e){
    res.status(502).json({ error: String(e && e.message || e) });
  }
}
