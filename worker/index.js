/**
 * LuckieLynx site worker.
 *
 * Serves the static site (./site) and one extra route:
 *   GET /api/file?t=<token>   streams a game build from R2
 *
 * The token comes from Supabase (create_download_token), is tied to one tester and one
 * build, and expires after 10 minutes. This worker only asks Supabase which file the
 * token unlocks, using the public anon key, so it holds no secrets.
 * Range requests are supported, so interrupted downloads can resume.
 */
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/file') return serveFile(request, url, env);
    if (url.pathname.startsWith('/api/')) return message(404, 'Not found', 'There is nothing here.');
    return env.ASSETS.fetch(request);
  },
};

const TOKEN_RE = /^[a-f0-9]{48}$/;

async function serveFile(request, url, env) {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return message(405, 'Not allowed', 'Downloads only work with a normal link.');
  }
  const t = url.searchParams.get('t') || '';
  if (!TOKEN_RE.test(t)) {
    return message(400, 'Link not valid', 'This download link is not valid. Start the download again from the downloads page.');
  }

  let key = null;
  try {
    const r = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/use_download_token`, {
      method: 'POST',
      headers: {
        apikey: env.SUPABASE_ANON_KEY,
        Authorization: `Bearer ${env.SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ t }),
    });
    if (!r.ok) throw new Error(`supabase ${r.status}`);
    const data = await r.json();
    key = data && typeof data.key === 'string' ? data.key : null;
  } catch (e) {
    return message(502, 'Try again', "We couldn't check your download link right now. Wait a minute and try again.");
  }
  if (!key) {
    return message(403, 'Link expired', 'This download link has expired. Go back to the downloads page and start the download again.');
  }

  const obj = request.method === 'HEAD'
    ? await env.BUILDS.head(key)
    : await env.BUILDS.get(key, { range: request.headers, onlyIf: request.headers });
  if (!obj) {
    return message(404, 'Build missing', 'This build file is missing. Let the LuckieLynx team know on Discord.');
  }

  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set('etag', obj.httpEtag);
  headers.set('accept-ranges', 'bytes');
  headers.set('cache-control', 'private, no-store');
  headers.set('content-disposition', `attachment; filename="${safeName(key)}"`);
  if (!headers.has('content-type')) headers.set('content-type', 'application/octet-stream');

  // HEAD, or a conditional request that matched (304): no body
  if (request.method === 'HEAD' || !('body' in obj) || !obj.body) {
    headers.set('content-length', String(obj.size));
    const status = request.method === 'HEAD' ? 200 : 304;
    return new Response(null, { status, headers });
  }

  const range = rangeOf(obj.range, obj.size);
  if (range) {
    headers.set('content-range', `bytes ${range.start}-${range.end}/${obj.size}`);
    headers.set('content-length', String(range.end - range.start + 1));
    return new Response(obj.body, { status: 206, headers });
  }
  headers.set('content-length', String(obj.size));
  return new Response(obj.body, { status: 200, headers });
}

// R2 reports the served range as {offset, length} or {suffix}; turn it into start/end.
function rangeOf(r, size) {
  if (!r) return null;
  let start, end;
  if ('suffix' in r && r.suffix !== undefined) {
    start = Math.max(0, size - r.suffix);
    end = size - 1;
  } else {
    start = r.offset || 0;
    end = r.length !== undefined ? start + r.length - 1 : size - 1;
  }
  if (start === 0 && end >= size - 1) return null;
  return { start, end: Math.min(end, size - 1) };
}

function safeName(key) {
  const base = key.split('/').pop() || 'LuckieLynx';
  return base.replace(/[^A-Za-z0-9._-]/g, '_');
}

function message(status, title, text) {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} · LuckieLynx</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#06120c;color:#f4f1e8;font-family:system-ui,sans-serif;padding:24px}
main{max-width:460px}h1{font-family:Georgia,serif;font-weight:500;font-size:40px;margin:0 0 12px}p{color:#b9c0bb;line-height:1.6}a{color:#e8bf4a}</style></head>
<body><main><h1>${title}</h1><p>${text}</p><p><a href="/download">Back to downloads</a></p></main></body></html>`;
  return new Response(html, { status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
}
