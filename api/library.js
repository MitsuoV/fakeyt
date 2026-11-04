const crypto = require('crypto');

const COOKIE = 'lowkey_sync';
const REDIS_KEY = 'lowkey:shared-library:v1';
const MAX_BODY = 1024 * 1024;

function timingSafeEqualText(left, right) {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function sign(value, secret) {
  return crypto.createHmac('sha256', secret).update(value).digest('base64url');
}

function sessionCookie(request, secret) {
  const raw = (request.headers.cookie || '').split(';').map((part) => part.trim()).find((part) => part.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
  if (!raw) return false;
  const [expires, signature] = decodeURIComponent(raw).split('.');
  if (!expires || !signature || Number(expires) < Date.now()) return false;
  return timingSafeEqualText(signature, sign(expires, secret));
}

async function redis(command) {
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  if (!url || !token) throw new Error('Playlist sync storage is not configured.');
  const result = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(command) });
  const data = await result.json();
  if (!result.ok || data.error) throw new Error('Playlist sync storage request failed.');
  return data.result;
}

function validPlaylists(value) {
  return Array.isArray(value) && value.length <= 500 && JSON.stringify(value).length <= MAX_BODY;
}

module.exports = async function handler(request, response) {
  const passphrase = process.env.LOWKEY_SYNC_PASSPHRASE;
  const sessionSecret = process.env.LOWKEY_SYNC_SESSION_SECRET;
  if (!passphrase || !sessionSecret) return response.status(503).json({ error: 'Playlist sync is not configured yet.' });

  if (request.method === 'POST') {
    const submitted = request.body?.passphrase;
    if (typeof submitted !== 'string' || !timingSafeEqualText(submitted, passphrase)) return response.status(401).json({ error: 'That passphrase did not match.' });
    const expires = String(Date.now() + 60 * 24 * 60 * 60 * 1000);
    const secure = request.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
    response.setHeader('Set-Cookie', `${COOKIE}=${encodeURIComponent(`${expires}.${sign(expires, sessionSecret)}`)}; HttpOnly; SameSite=Strict; Path=/api/library; Max-Age=5184000${secure}`);
    return response.status(200).json({ ok: true });
  }

  if (request.method === 'DELETE') {
    response.setHeader('Set-Cookie', `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/api/library; Max-Age=0; Secure`);
    return response.status(200).json({ ok: true });
  }

  if (!sessionCookie(request, sessionSecret)) return response.status(401).json({ error: 'Connect this device to your shared library.' });

  try {
    if (request.method === 'GET') {
      const result = await redis(['HMGET', REDIS_KEY, 'version', 'playlists']);
      return response.status(200).json({ version: Number(result?.[0] || 0), playlists: result?.[1] ? JSON.parse(result[1]) : [] });
    }

    if (request.method === 'PUT') {
      const { version, playlists } = request.body || {};
      if (!Number.isSafeInteger(version) || version < 0 || !validPlaylists(playlists)) return response.status(400).json({ error: 'Invalid playlist data.' });
      const script = "local v=tonumber(redis.call('HGET',KEYS[1],'version') or '0'); if v~=tonumber(ARGV[1]) then return {-1,v,redis.call('HGET',KEYS[1],'playlists') or '[]'} end; local n=v+1; redis.call('HSET',KEYS[1],'version',n,'playlists',ARGV[2]); return {n,n,ARGV[2]}";
      const result = await redis(['EVAL', script, '1', REDIS_KEY, String(version), JSON.stringify(playlists)]);
      if (Number(result?.[0]) === -1) return response.status(409).json({ error: 'The shared library changed on another device.', version: Number(result[1]), playlists: JSON.parse(result[2] || '[]') });
      return response.status(200).json({ version: Number(result[0]), playlists });
    }

    response.setHeader('Allow', 'GET, PUT, POST, DELETE');
    return response.status(405).json({ error: 'Method not allowed.' });
  } catch (error) {
    return response.status(503).json({ error: error.message || 'Could not reach playlist sync storage.' });
  }
};

