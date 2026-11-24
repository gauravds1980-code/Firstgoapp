// Learn more https://docs.expo.dev/guides/customizing-metro
const http = require('http');
const { getDefaultConfig } = require('expo/metro-config');

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname);

/**
 * Dev-server proxy: /voice and /voice/* → local voice pipeline (Whisper + LaBSE + Piper) on 8793,
 * with the /voice prefix stripped (/voice/command → /command). Lets a phone reach the pipeline
 * through the existing Expo tunnel (e.g. https://<id>-anonymous-8081.exp.direct/voice).
 * Bundling is unchanged; only requests under /voice are intercepted.
 */
const VOICE_HOST = '127.0.0.1';
const VOICE_PORT = 8793;
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'content-type',
};
// Hop-by-hop headers must not be forwarded.
const HOP = new Set(['connection', 'keep-alive', 'proxy-connection', 'transfer-encoding', 'te', 'trailer', 'upgrade', 'host']);

function voiceProxy(req, res, next) {
  const url = req.url || '';
  if (!(url === '/voice' || url.startsWith('/voice/') || url.startsWith('/voice?'))) return next();

  if (req.method === 'OPTIONS') {
    res.writeHead(204, { ...CORS, 'Access-Control-Max-Age': '600' });
    return res.end();
  }

  let path = url.slice('/voice'.length) || '/';
  if (path.startsWith('?')) path = '/' + path;

  const headers = {};
  for (const [k, v] of Object.entries(req.headers)) if (!HOP.has(k.toLowerCase()) && v !== undefined) headers[k] = v;
  headers.host = `${VOICE_HOST}:${VOICE_PORT}`;
  // Keep chunked bodies working when no content-length was sent.
  if (req.headers['transfer-encoding'] && !req.headers['content-length']) headers['transfer-encoding'] = 'chunked';

  let done = false;
  const fail = () => {
    if (done) return;
    done = true;
    if (res.headersSent) return res.destroy();
    res.writeHead(502, { ...CORS, 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'voice proxy unavailable' }));
  };

  const upstream = http.request(
    { host: VOICE_HOST, port: VOICE_PORT, method: req.method, path, headers },
    (up) => {
      done = true;
      const out = { ...up.headers, ...CORS };
      res.writeHead(up.statusCode || 502, out);
      up.pipe(res);
      up.on('error', () => res.destroy());
    },
  );
  upstream.setTimeout(60_000, () => upstream.destroy(new Error('timeout')));
  upstream.on('error', fail);
  req.on('aborted', () => upstream.destroy());
  req.pipe(upstream); // stream audio bodies (can be a few MB) without buffering
}

const prevEnhance = config.server && config.server.enhanceMiddleware;
config.server = {
  ...config.server,
  enhanceMiddleware: (middleware, server) => {
    const base = prevEnhance ? prevEnhance(middleware, server) : middleware;
    return (req, res, next) => voiceProxy(req, res, () => base(req, res, next));
  },
};

module.exports = config;
