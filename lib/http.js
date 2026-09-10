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

/** Reject cross-site writes. LAN / reverse-proxy UIs are allowed. */
export function isTrustedSettingsRequest(request) {
  const site = request.headers && request.headers['sec-fetch-site'];
  return site !== 'cross-site';
}
