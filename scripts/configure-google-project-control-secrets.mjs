import { chmod, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const credentialsDirectory = path.resolve('.keys/google-project-control');
const outputPath = path.join(credentialsDirectory, 'supabase-google-pm.env');
const files = await readdir(credentialsDirectory);
const oauthFile = files.find((name) => name.startsWith('client_secret_') && name.endsWith('.json'));
const serviceAccountFile = files.find((name) => /^rasika-project-control-[a-f0-9]+\.json$/i.test(name));
if (!oauthFile || !serviceAccountFile) throw new Error('OAuth and service-account JSON files are required');

const oauthPayload = JSON.parse(await readFile(path.join(credentialsDirectory, oauthFile), 'utf8'));
const oauth = oauthPayload.web || oauthPayload.installed;
const serviceAccountRaw = await readFile(path.join(credentialsDirectory, serviceAccountFile));
const serviceAccount = JSON.parse(serviceAccountRaw.toString('utf8'));
const refreshPayload = JSON.parse(await readFile(path.join(credentialsDirectory, 'google-calendar-refresh-token.json'), 'utf8'));
if (!oauth?.client_id || !oauth?.client_secret) throw new Error('OAuth client credentials are incomplete');
if (serviceAccount.project_id !== 'rasika-project-control' || !serviceAccount.client_email || !serviceAccount.private_key) {
  throw new Error('Unexpected Google service-account credential');
}
if (refreshPayload.email !== 'jose.contreras@rasika.cl' || !refreshPayload.refresh_token) {
  throw new Error('Unexpected Google Calendar refresh credential');
}

const quote = (value) => JSON.stringify(String(value));
const entries = {
  GOOGLE_PM_OWNER_EMAIL: 'jose.contreras@rasika.cl',
  GOOGLE_PM_CALENDAR_ID: 'c_371dae0a58434ad75a4d2cc4ae82ccf1920b9fb3afabe7cffec02053be940cfa@group.calendar.google.com',
  GOOGLE_PM_MEETING_CALENDAR_ID: 'primary',
  GOOGLE_PM_DRIVE_ID: '0AA-3yjbkRfemUk9PVA',
  GOOGLE_PM_DRIVE_ROOT_FOLDER_ID: '1rTBB60_7gSFJpxCkaWyFt7Y1tECC-Gzz',
  GOOGLE_PM_OAUTH_CLIENT_ID: oauth.client_id,
  GOOGLE_PM_OAUTH_CLIENT_SECRET: oauth.client_secret,
  GOOGLE_PM_OAUTH_REFRESH_TOKEN: refreshPayload.refresh_token,
  GOOGLE_PM_SERVICE_ACCOUNT_JSON_B64: serviceAccountRaw.toString('base64'),
};
await writeFile(outputPath, `${Object.entries(entries).map(([name, value]) => `${name}=${quote(value)}`).join('\n')}\n`, { mode: 0o600 });
await chmod(outputPath, 0o600);
console.log(`Prepared ${Object.keys(entries).length} Google Project Control secrets in a Git-ignored file.`);
