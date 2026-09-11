import { createServer } from 'node:http';
import { createHash, randomBytes } from 'node:crypto';
import { chmod, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const credentialsDirectory = path.resolve('.keys/google-project-control');
const callbackPort = 53682;
const callbackUrl = `http://127.0.0.1:${callbackPort}/oauth2callback`;
const expectedEmail = 'jose.contreras@rasika.cl';
const tokenPath = path.join(credentialsDirectory, 'google-calendar-refresh-token.json');

function base64Url(value) {
  return Buffer.from(value).toString('base64url');
}

function html(message, success = false) {
  const safe = String(message).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;',
  })[character]);
  return `<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Rasika Project Control</title><body style="margin:0;background:#0b0d0f;color:#edf2f3;font:16px system-ui;display:grid;min-height:100vh;place-items:center"><main style="max-width:620px;padding:36px;border:1px solid #2b3035;border-radius:14px;background:#14171a"><h1 style="margin:0 0 12px;font-size:24px">${success ? 'Calendar conectado' : 'No se pudo conectar Calendar'}</h1><p style="margin:0;color:#a7b0b5;line-height:1.55">${safe}</p></main></body></html>`;
}

const files = await readdir(credentialsDirectory);
const clientFile = files.find((name) => name.startsWith('client_secret_') && name.endsWith('.json'));
if (!clientFile) throw new Error('OAuth client JSON not found in .keys/google-project-control');
const clientPayload = JSON.parse(await readFile(path.join(credentialsDirectory, clientFile), 'utf8'));
const client = clientPayload.web || clientPayload.installed;
if (!client?.client_id || !client?.client_secret) throw new Error('OAuth client JSON is incomplete');

const state = base64Url(randomBytes(32));
const codeVerifier = base64Url(randomBytes(64));
const codeChallenge = base64Url(createHash('sha256').update(codeVerifier).digest());
const scopes = [
  'openid',
  'email',
  'https://www.googleapis.com/auth/calendar.events.owned',
  'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
  'https://www.googleapis.com/auth/calendar.events.freebusy',
];
const authorizationUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
authorizationUrl.search = new URLSearchParams({
  client_id: client.client_id,
  redirect_uri: callbackUrl,
  response_type: 'code',
  scope: scopes.join(' '),
  access_type: 'offline',
  include_granted_scopes: 'true',
  prompt: 'consent',
  login_hint: expectedEmail,
  state,
  code_challenge: codeChallenge,
  code_challenge_method: 'S256',
}).toString();

let timeout;
const completed = new Promise((resolve, reject) => {
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url || '/', callbackUrl);
      if (url.pathname !== '/oauth2callback') {
        response.writeHead(404).end('Not found');
        return;
      }
      if (url.searchParams.get('state') !== state) throw new Error('OAuth state validation failed');
      if (url.searchParams.get('error')) throw new Error(`Google authorization failed: ${url.searchParams.get('error')}`);
      const code = url.searchParams.get('code');
      if (!code) throw new Error('Google did not return an authorization code');

      const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: client.client_id,
          client_secret: client.client_secret,
          code,
          code_verifier: codeVerifier,
          redirect_uri: callbackUrl,
          grant_type: 'authorization_code',
        }),
      });
      const tokens = await tokenResponse.json();
      if (!tokenResponse.ok || !tokens.access_token || !tokens.refresh_token) {
        throw new Error(tokens.error_description || tokens.error || 'Google did not return an offline refresh token');
      }
      const userResponse = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
      });
      const user = await userResponse.json();
      if (!userResponse.ok || String(user.email || '').toLowerCase() !== expectedEmail) {
        throw new Error(`Expected ${expectedEmail}, but Google authorized ${user.email || 'an unknown account'}`);
      }

      await writeFile(tokenPath, `${JSON.stringify({
        email: expectedEmail,
        refresh_token: tokens.refresh_token,
        scope: tokens.scope || scopes.join(' '),
        token_type: tokens.token_type || 'Bearer',
        created_at: new Date().toISOString(),
      }, null, 2)}\n`, { mode: 0o600 });
      await chmod(tokenPath, 0o600);
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(html('La autorización quedó guardada de forma privada. Puedes cerrar esta pestaña.', true));
      clearTimeout(timeout);
      server.close(() => resolve());
    } catch (error) {
      response.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' }).end(html(error instanceof Error ? error.message : 'Unknown OAuth error'));
      clearTimeout(timeout);
      server.close(() => reject(error));
    }
  });
  server.listen(callbackPort, '127.0.0.1', () => {
    console.log(`GOOGLE_PM_AUTHORIZATION_URL=${authorizationUrl}`);
    console.log(`Waiting for Google authorization on ${callbackUrl}`);
  });
  timeout = setTimeout(() => server.close(() => reject(new Error('Google authorization timed out'))), 10 * 60 * 1000);
});

await completed;
console.log('Google Calendar refresh credential saved securely.');
