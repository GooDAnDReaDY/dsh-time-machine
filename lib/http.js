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

export function isLoopbackAddress(value) {
  const address = String(value || '').toLowerCase().replace(/^\[|\]$/g, '');
  return address === 'localhost' || address === 'localhost.' || address === '::1'
    || address.startsWith('127.')
    || address.startsWith('::ffff:127.');
}

export function isPrivateLanAddress(value) {
  const address = String(value || '').toLowerCase().replace(/^\[|\]$/g, '');
  if (!address) return false;
  const ipv4 = address.startsWith('::ffff:') ? address.slice(7) : address;
  return (
    /^192\.168\./.test(ipv4) ||
    ipv4.startsWith('10.') ||
    /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(ipv4)
  );
}

export function getConnection(ctx) {
  try {
    const fromCtx = ctx?.reflect?.get
      ? (ctx.reflect.get('connection') || ctx?.connection)
      : (ctx?.get ? (ctx.get('connection') || ctx?.connection) : Reflect.get(ctx || {}, 'connection'));
    if (fromCtx) return fromCtx;
    if (ctx?.root) {
      return getConnection(ctx.root);
    }
    return undefined;
  } catch {
    return undefined;
  }
}

/** Reject cross-site and same-site writes while allowing trusted network origins and verified loopback/LAN requests. */
export function isTrustedSettingsRequest(request, ctx = null) {
  if (!request || typeof request !== 'object') return false;

  if (ctx) {
    const conn = getConnection(ctx) || request?.connectionService;
    if (conn && typeof conn.requestRejection === 'function') {
      let rejection;
      try {
        rejection = conn.requestRejection(request);
      } catch {
        return false;
      }
      if (rejection !== undefined) return false;
    }
  }

  const secFetchSite = header(request, 'sec-fetch-site');
  if (secFetchSite === 'cross-site' || secFetchSite === 'same-site') {
    return false;
  }

  const remoteAddress = request?.socket?.remoteAddress || request?.connection?.remoteAddress;
  const remoteIsLoopback = isLoopbackAddress(remoteAddress);
  const remoteIsLan = isPrivateLanAddress(remoteAddress);

  // Connection must originate from either loopback or private LAN (never public Internet)
  if (!remoteIsLoopback && !remoteIsLan) {
    return false;
  }

  // Never trust x-forwarded-host; strictly use host header
  const host = header(request, 'host');
  const origin = header(request, 'origin');
  if (origin !== undefined) {
    if (origin === 'null') return false;
    try {
      const url = new URL(origin);
      if (host && url.host.toLowerCase() === host.toLowerCase()) {
        return true;
      }
      if (isLoopbackAddress(url.hostname) && remoteIsLoopback) {
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  const referer = header(request, 'referer');
  if (referer !== undefined) {
    try {
      const url = new URL(referer);
      if (host && url.host.toLowerCase() === host.toLowerCase()) {
        return true;
      }
      if (isLoopbackAddress(url.hostname) && remoteIsLoopback) {
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  // Requests without origin/referer (e.g. curl or internal requests): allow ONLY if loopback
  if (remoteIsLoopback) {
    return true;
  }

  return false;
}

/**
 * Canonical DSH connection authentication & CSRF boundary for HTTP endpoints (#99).
 * Returns true if request is authorized; otherwise writes 401/403 and returns false.
 */
export function assertTrustedSettingsRequest(req, res, ctx = null) {
  // 1. Layer 1: CSRF & Origin/Host & Network boundary
  if (!isTrustedSettingsRequest(req, null)) {
    writeJson(res, 403, { success: false, error: 'cross-site requests forbidden' });
    return false;
  }

  const remoteAddress = req?.socket?.remoteAddress || req?.connection?.remoteAddress;
  const remoteIsLoopback = isLoopbackAddress(remoteAddress);

  // 2. Layer 2: DSH Connection Service session authentication
  const conn = getConnection(ctx) || req?.connectionService;
  if (conn && typeof conn.requestRejection === 'function') {
    let rejection;
    try {
      rejection = conn.requestRejection(req);
    } catch {
      writeJson(res, 401, { success: false, error: 'Authentication service error' });
      return false;
    }
    if (rejection !== undefined) {
      const code = rejection === 403 ? 403 : 401;
      writeJson(res, code, {
        success: false,
        error: code === 403 ? 'Forbidden' : 'Authentication required',
      });
      return false;
    }
    return true;
  }

  // 3. Layer 3: Remote/LAN callers require connection authentication (fail-closed)
  if (!remoteIsLoopback) {
    writeJson(res, 401, { success: false, error: 'Authentication required for remote caller' });
    return false;
  }

  return true;
}
