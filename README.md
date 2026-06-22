# Synoptica

AI-powered geopolitical event deep-dive engine. *Every event, every angle.*

This repo is a complete, deployable app:

- **`public/index.html`** — the front end (the whole Synoptica interface).
- **`api/analyze.js`** — the backend. A serverless function that holds your
  Anthropic API key, calls Claude, and protects your spend. **This is the only
  place your key lives — it never reaches the browser.**

---

## What the backend does (Phase 1)

1. **Hides your API key.** The browser calls `/api/analyze`; only the server
   talks to Anthropic. This is the whole reason a backend exists — without it,
   the search feature can't run on a real website.
2. **Caps cost.** The server decides how many web searches each query may run
   (`MAX_SEARCHES`), so a visitor can't inflate it.
3. **Rate-limits** each visitor (`RATE_PER_HOUR`) so one person or a bot can't
   run up your bill.
4. **Caches** results so a repeated event is served instantly instead of paying
   to regenerate it.

Caching and rate-limiting work immediately using in-memory storage (fine for you
and a few friends). To make them durable at scale, add an Upstash Redis database
(see "Going bigger" below) — no code change needed.

---

## Deploy it (about 10 minutes, no terminal required)

You need: a [GitHub](https://github.com) account, a [Vercel](https://vercel.com)
account (free, sign in with GitHub), and your Anthropic API key from
[console.anthropic.com](https://console.anthropic.com).

> ⚠️ Before sharing the site, make sure you've set a **spend limit** in the
> Anthropic Console. The rate limit here is a seatbelt, not a guarantee.

### 1. Put this folder in a GitHub repo
Create a new repository on GitHub and upload these files (keep the folder
structure — `api/` and `public/` must stay as folders).

### 2. Import the repo into Vercel
- Go to [vercel.com/new](https://vercel.com/new) → select your repo → **Import**.
- Framework preset: **Other** (Vercel auto-detects the `api/` function and serves
  `public/` as the site — no build step needed).

### 3. Add your API key
In the import screen (or later under **Settings → Environment Variables**), add:

| Name | Value |
|------|-------|
| `ANTHROPIC_API_KEY` | your `sk-ant-…` key |

(Optional: `MAX_SEARCHES`, `RATE_PER_HOUR`, `CACHE_TTL_SECS` — defaults are fine.)

### 4. Deploy
Click **Deploy**. In ~1 minute you'll get a live URL like
`https://synoptica-yourname.vercel.app`. Open it, run a search — done.

Anyone you send that URL to can use it in their browser. No download, no account.

---

## Run it locally (optional)

```bash
npm i -g vercel        # one-time
vercel dev             # starts a local server, prompts for env vars
```

Or just open `public/index.html` directly to see the UI — but the search won't
work without the backend running (that's expected; it needs the key).

---

## Going bigger (durable cache + rate limiting)

The in-memory cache/limiter reset when the serverless function goes cold. For
real traffic, add a free **Upstash Redis** database:

1. Create one at [upstash.com](https://upstash.com) → copy its **REST URL** and
   **REST token**.
2. Add two env vars in Vercel:
   - `UPSTASH_REDIS_REST_URL`
   - `UPSTASH_REDIS_REST_TOKEN`
3. Redeploy. Caching and rate-limiting are now durable across all instances.
   No code change.

---

## Cost notes

- Every search calls Claude and is billed per token at your API rate.
- A deep dive runs several searches → roughly $0.15–0.25 each; quick read is much
  cheaper. Caching makes repeats free.
- **Your spend cap in the Anthropic Console is the real safety net.** Set it
  before going public.

---

## What's next (Phase 2+)

- Server-side JSON schema validation + auto-retry (kills malformed-output errors).
- Permanent share links (store a result under an ID).
- Live trending (pull a real news/markets feed).
- Streaming responses, sign-in, search history.

These build on top of this Phase 1 foundation.
