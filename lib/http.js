export function writeJson(res, code, body) {
  try {
    res.writeHead(code, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    });
    res.end(JSON.stringify(body));
  } catch {
    /* socket already closed */
  }
}

export function readBody(req, maxBytes = 256 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > maxBytes) {
        const err = new Error('payload too large');
        err.statusCode = 413;
        reject(err);
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        const parsed = raw ? JSON.parse(raw) : {};
        resolve(parsed);
      } catch (e) {
        const err = new Error('invalid json');
        err.statusCode = 400;
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

/** Reject cross-site writes (fail-closed). LAN / reverse-proxy UIs and loopback are allowed. */
export function isTrustedSettingsRequest(req) {
  if (!req || typeof req !== 'object') return false;

  const rawAuth = req.headers?.['authorization'];
  if (typeof rawAuth === 'string' && rawAuth.startsWith('Bearer ')) return true;

  const cookieHeader = req.headers?.['cookie'];
  if (typeof cookieHeader === 'string' && (cookieHeader.includes('token=') || cookieHeader.includes('dsh_token='))) {
    return true;
  }

  const site = req.headers?.['sec-fetch-site'];
  if (site === 'same-origin' || site === 'none') return true;

  const remote = req.socket?.remoteAddress || '';
  if (remote === '127.0.0.1' || remote === '::1' || remote === '::ffff:127.0.0.1') return true;

  const origin = req.headers?.['origin'];
  const host = req.headers?.['host'];
  if (origin && host) {
    try {
      const parsedOrigin = new URL(origin);
      if (parsedOrigin.host === host) return true;
    } catch {
      if (origin.endsWith('://' + host)) return true;
    }
  }

  return false;
}
