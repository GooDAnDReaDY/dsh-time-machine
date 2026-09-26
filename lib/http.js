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

function header(request, name) {
  const value = request?.headers?.[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

function isLoopbackAddress(value) {
  const address = String(value || '').toLowerCase().replace(/^[\[\]]/g, '');
  return address === 'localhost' || address === 'localhost.' || address === '::1'
    || address.startsWith('127.')
    || address.startsWith('::ffff:127.');
}

/** Reject cross-site and same-site writes (fail-closed) while allowing local loopback and verified same-origin requests. */
export function isTrustedSettingsRequest(request) {
  if (!request || typeof request !== 'object') return false;

  const secFetchSite = header(request, 'sec-fetch-site');
  if (secFetchSite === 'cross-site' || secFetchSite === 'same-site') {
    return false;
  }

  const isLoopback = isLoopbackAddress(request?.socket?.remoteAddress);
  const host = header(request, 'x-forwarded-host') || header(request, 'host');
  const origin = header(request, 'origin');
  if (origin) {
    try {
      const url = new URL(origin);
      if (host && url.host.toLowerCase() === host.toLowerCase()) {
        return true;
      }
      if (isLoopbackAddress(url.hostname) && isLoopback) {
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  const referer = header(request, 'referer');
  if (referer) {
    try {
      const url = new URL(referer);
      if (host && url.host.toLowerCase() === host.toLowerCase()) {
        return true;
      }
      if (isLoopbackAddress(url.hostname) && isLoopback) {
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  // Requests without origin/referer (e.g. curl or internal requests): allow if loopback
  if (isLoopback) {
    return true;
  }

  // If sec-fetch-site is explicitly same-origin and no origin/referer, allow
  if (secFetchSite === 'same-origin') {
    return true;
  }

  return false;
}
