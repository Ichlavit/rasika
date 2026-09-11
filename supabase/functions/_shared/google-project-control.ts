type JsonRecord = Record<string, unknown>;

export type CalendarEventInput = {
  calendarId: string;
  eventId: string;
  summary: string;
  description: string;
  localStart: string;
  durationMinutes: number;
  timezone: string;
  attendees?: Array<{ email: string; displayName?: string }>;
  createMeet?: boolean;
  sendUpdates?: "all" | "externalOnly" | "none";
  privateProperties: Record<string, string>;
};

export type DriveItem = {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime?: string;
  createdTime?: string;
  parents?: string[];
  webViewLink?: string;
  size?: string;
  md5Checksum?: string;
  version?: string;
  folderPath: string;
};

export type CalendarEventSummary = {
  id: string;
  calendarId: string;
  calendarLabel: string;
  summary: string;
  description: string;
  startsAt: string;
  endsAt: string;
  htmlLink: string | null;
  conferenceUrl: string | null;
  location: string;
  attendees: Array<{ email: string; displayName?: string; responseStatus?: string }>;
};

export type DriveConnectionTestResult = {
  folder: DriveItem;
  file: DriveItem;
  folderCreated: boolean;
  fileCreated: boolean;
};

const LOCAL_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/;

function requiredEnv(name: string) {
  const value = String(Deno.env.get(name) || "").trim();
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}

function encodeBase64Url(value: Uint8Array | string) {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function decodeBase64(value: string) {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function pemPrivateKeyBytes(pem: string) {
  const body = pem
    .replace(/-----BEGIN PRIVATE KEY-----/g, "")
    .replace(/-----END PRIVATE KEY-----/g, "")
    .replace(/\s+/g, "");
  if (!body) throw new Error("Google service-account private key is invalid");
  return decodeBase64(body);
}

async function parseTokenResponse(response: Response) {
  const payload = await response.json().catch(() => ({})) as JsonRecord;
  if (!response.ok || typeof payload.access_token !== "string") {
    const detail = String(payload.error_description || payload.error || `HTTP ${response.status}`);
    throw new Error(`Google token request failed: ${detail.slice(0, 300)}`);
  }
  return payload.access_token;
}

export async function getCalendarAccessToken() {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: requiredEnv("GOOGLE_PM_OAUTH_CLIENT_ID"),
      client_secret: requiredEnv("GOOGLE_PM_OAUTH_CLIENT_SECRET"),
      refresh_token: requiredEnv("GOOGLE_PM_OAUTH_REFRESH_TOKEN"),
      grant_type: "refresh_token",
    }),
  });
  return await parseTokenResponse(response);
}

export async function getDriveAccessToken() {
  const encodedCredentials = requiredEnv("GOOGLE_PM_SERVICE_ACCOUNT_JSON_B64");
  let credentials: JsonRecord;
  try {
    credentials = JSON.parse(new TextDecoder().decode(decodeBase64(encodedCredentials))) as JsonRecord;
  } catch {
    throw new Error("Google service-account credentials are invalid");
  }
  const clientEmail = String(credentials.client_email || "").trim();
  const privateKey = String(credentials.private_key || "");
  if (!clientEmail || !privateKey) throw new Error("Google service-account credentials are incomplete");

  const issuedAt = Math.floor(Date.now() / 1000);
  const header = encodeBase64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = encodeBase64Url(JSON.stringify({
    iss: clientEmail,
    scope: [
      "https://www.googleapis.com/auth/drive",
      "https://www.googleapis.com/auth/documents.readonly",
    ].join(" "),
    aud: "https://oauth2.googleapis.com/token",
    iat: issuedAt,
    exp: issuedAt + 3600,
  }));
  const unsigned = `${header}.${claims}`;
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemPrivateKeyBytes(privateKey),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = new Uint8Array(await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(unsigned),
  ));
  const assertion = `${unsigned}.${encodeBase64Url(signature)}`;
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  return await parseTokenResponse(response);
}

function normalizeLocalDateTime(value: string) {
  const text = String(value || "").trim();
  if (!LOCAL_DATE_TIME.test(text)) throw new Error("A valid local event date and time is required");
  return text.length === 16 ? `${text}:00` : text;
}

function addMinutesToLocalDateTime(value: string, minutes: number) {
  const [datePart, timePart] = value.split("T");
  const [year, month, day] = datePart.split("-").map(Number);
  const [hour, minute, second = 0] = timePart.split(":").map(Number);
  const instant = new Date(Date.UTC(year, month - 1, day, hour, minute + minutes, second));
  return instant.toISOString().slice(0, 19);
}

async function calendarJson(url: string, accessToken: string, init: RequestInit = {}) {
  const response = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  const payload = await response.json().catch(() => ({})) as JsonRecord;
  return { response, payload };
}

function googleCalendarError(payload: JsonRecord, status: number) {
  return String(payload.error && typeof payload.error === "object"
    ? (payload.error as JsonRecord).message
    : payload.error || `HTTP ${status}`);
}

function calendarEventSummary(calendarId: string, calendarLabel: string, event: JsonRecord): CalendarEventSummary | null {
  const id = String(event.id || "").trim();
  if (!id || String(event.status || "") === "cancelled") return null;
  const start = event.start && typeof event.start === "object" ? event.start as JsonRecord : {};
  const end = event.end && typeof event.end === "object" ? event.end as JsonRecord : {};
  const conferenceData = event.conferenceData && typeof event.conferenceData === "object" ? event.conferenceData as JsonRecord : {};
  const entryPoints = Array.isArray(conferenceData.entryPoints) ? conferenceData.entryPoints as JsonRecord[] : [];
  const conferenceUrl = String(event.hangoutLink || entryPoints.find((entry) => entry.entryPointType === "video")?.uri || "").trim();
  const attendees = Array.isArray(event.attendees) ? event.attendees as JsonRecord[] : [];
  return {
    id,
    calendarId,
    calendarLabel,
    summary: String(event.summary || "Evento sin título").trim().slice(0, 500),
    description: String(event.description || "").trim().slice(0, 4000),
    startsAt: String(start.dateTime || start.date || "").trim(),
    endsAt: String(end.dateTime || end.date || "").trim(),
    htmlLink: /^https:\/\//.test(String(event.htmlLink || "")) ? String(event.htmlLink) : null,
    conferenceUrl: /^https:\/\//.test(conferenceUrl) ? conferenceUrl : null,
    location: String(event.location || "").trim().slice(0, 500),
    attendees: attendees.slice(0, 100).flatMap((attendee) => {
      const email = String(attendee.email || "").trim().toLowerCase();
      if (!email) return [];
      return [{
        email,
        ...(attendee.displayName ? { displayName: String(attendee.displayName).slice(0, 200) } : {}),
        ...(attendee.responseStatus ? { responseStatus: String(attendee.responseStatus).slice(0, 40) } : {}),
      }];
    }),
  };
}

export async function listCalendarEvents(input: {
  calendars: Array<{ id: string; label: string }>;
  timeMin: string;
  timeMax: string;
  query?: string;
  maxResults?: number;
}) {
  const accessToken = await getCalendarAccessToken();
  const events: CalendarEventSummary[] = [];
  const maxResults = Math.max(1, Math.min(100, Math.round(input.maxResults || 50)));
  for (const calendar of input.calendars.slice(0, 10)) {
    const params = new URLSearchParams({
      singleEvents: "true",
      orderBy: "startTime",
      showDeleted: "false",
      timeMin: input.timeMin,
      timeMax: input.timeMax,
      maxResults: String(maxResults),
    });
    if (input.query?.trim()) params.set("q", input.query.trim().slice(0, 200));
    const { response, payload } = await calendarJson(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendar.id)}/events?${params}`,
      accessToken,
    );
    if (!response.ok) throw new Error(`Google Calendar listing failed: ${googleCalendarError(payload, response.status).slice(0, 400)}`);
    const items = Array.isArray(payload.items) ? payload.items as JsonRecord[] : [];
    for (const item of items) {
      const normalized = calendarEventSummary(calendar.id, calendar.label, item);
      if (normalized) events.push(normalized);
    }
  }
  return events
    .sort((left, right) => left.startsAt.localeCompare(right.startsAt))
    .slice(0, maxResults);
}

export async function getCalendarEvent(calendarId: string, calendarLabel: string, eventId: string) {
  const accessToken = await getCalendarAccessToken();
  const { response, payload } = await calendarJson(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
    accessToken,
  );
  if (!response.ok) throw new Error(`Google Calendar event lookup failed: ${googleCalendarError(payload, response.status).slice(0, 400)}`);
  const normalized = calendarEventSummary(calendarId, calendarLabel, payload);
  if (!normalized) throw new Error("Google Calendar event is unavailable");
  return normalized;
}

export async function createCalendarEvent(input: CalendarEventInput) {
  const accessToken = await getCalendarAccessToken();
  const start = normalizeLocalDateTime(input.localStart);
  const durationMinutes = Math.max(15, Math.min(1440, Math.round(input.durationMinutes)));
  const calendarBase = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(input.calendarId)}/events`;
  const body: JsonRecord = {
    id: input.eventId,
    summary: input.summary.slice(0, 500),
    description: input.description.slice(0, 8000),
    start: { dateTime: start, timeZone: input.timezone },
    end: { dateTime: addMinutesToLocalDateTime(start, durationMinutes), timeZone: input.timezone },
    visibility: "private",
    transparency: "opaque",
    extendedProperties: { private: input.privateProperties },
    reminders: { useDefault: true },
  };
  if (input.attendees?.length) {
    body.attendees = input.attendees.slice(0, 100).map((attendee) => ({
      email: attendee.email,
      ...(attendee.displayName ? { displayName: attendee.displayName.slice(0, 200) } : {}),
    }));
    body.guestsCanInviteOthers = false;
    body.guestsCanModify = false;
  }
  if (input.createMeet) {
    body.conferenceData = {
      createRequest: {
        requestId: `${input.eventId}-${crypto.randomUUID()}`.slice(0, 128),
        conferenceSolutionKey: { type: "hangoutsMeet" },
      },
    };
  }

  const params = new URLSearchParams({
    sendUpdates: input.sendUpdates || "none",
    conferenceDataVersion: input.createMeet ? "1" : "0",
  });
  const created = await calendarJson(`${calendarBase}?${params}`, accessToken, {
    method: "POST",
    body: JSON.stringify(body),
  });
  if (created.response.ok) return created.payload;
  if (created.response.status === 409) {
    const existing = await calendarJson(`${calendarBase}/${encodeURIComponent(input.eventId)}`, accessToken);
    if (existing.response.ok) return existing.payload;
  }
  const detail = String(created.payload.error && typeof created.payload.error === "object"
    ? (created.payload.error as JsonRecord).message
    : created.payload.error || `HTTP ${created.response.status}`);
  throw new Error(`Google Calendar event creation failed: ${detail.slice(0, 400)}`);
}

async function listDriveChildren(
  accessToken: string,
  sharedDriveId: string,
  folderId: string,
  folderPath: string,
) {
  const items: DriveItem[] = [];
  let pageToken = "";
  do {
    const params = new URLSearchParams({
      q: `'${folderId}' in parents and trashed = false`,
      corpora: "drive",
      driveId: sharedDriveId,
      includeItemsFromAllDrives: "true",
      supportsAllDrives: "true",
      pageSize: "1000",
      fields: "nextPageToken,files(id,name,mimeType,modifiedTime,createdTime,parents,webViewLink,size,md5Checksum,version)",
    });
    if (pageToken) params.set("pageToken", pageToken);
    const response = await fetch(`https://www.googleapis.com/drive/v3/files?${params}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const payload = await response.json().catch(() => ({})) as JsonRecord;
    if (!response.ok) {
      const detail = String(payload.error && typeof payload.error === "object"
        ? (payload.error as JsonRecord).message
        : payload.error || `HTTP ${response.status}`);
      throw new Error(`Google Drive listing failed: ${detail.slice(0, 400)}`);
    }
    const files = Array.isArray(payload.files) ? payload.files as JsonRecord[] : [];
    for (const file of files) {
      const name = String(file.name || "").trim();
      const id = String(file.id || "").trim();
      const mimeType = String(file.mimeType || "").trim();
      if (!id || !name || !mimeType) continue;
      items.push({
        id,
        name,
        mimeType,
        modifiedTime: typeof file.modifiedTime === "string" ? file.modifiedTime : undefined,
        createdTime: typeof file.createdTime === "string" ? file.createdTime : undefined,
        parents: Array.isArray(file.parents) ? file.parents.map(String) : undefined,
        webViewLink: typeof file.webViewLink === "string" ? file.webViewLink : undefined,
        size: typeof file.size === "string" ? file.size : undefined,
        md5Checksum: typeof file.md5Checksum === "string" ? file.md5Checksum : undefined,
        version: typeof file.version === "string" ? file.version : undefined,
        folderPath,
      });
    }
    pageToken = typeof payload.nextPageToken === "string" ? payload.nextPageToken : "";
  } while (pageToken);
  return items;
}

function driveError(payload: JsonRecord, status: number) {
  return String(payload.error && typeof payload.error === "object"
    ? (payload.error as JsonRecord).message
    : payload.error || `HTTP ${status}`);
}

async function driveFileMetadata(accessToken: string, fileId: string, folderPath = "") {
  const params = new URLSearchParams({
    supportsAllDrives: "true",
    fields: "id,name,mimeType,modifiedTime,createdTime,parents,webViewLink,size,md5Checksum,version",
  });
  const response = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?${params}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const payload = await response.json().catch(() => ({})) as JsonRecord;
  if (!response.ok) throw new Error(`Google Drive metadata lookup failed: ${driveError(payload, response.status).slice(0, 400)}`);
  return {
    id: String(payload.id || ""),
    name: String(payload.name || ""),
    mimeType: String(payload.mimeType || ""),
    modifiedTime: typeof payload.modifiedTime === "string" ? payload.modifiedTime : undefined,
    createdTime: typeof payload.createdTime === "string" ? payload.createdTime : undefined,
    parents: Array.isArray(payload.parents) ? payload.parents.map(String) : undefined,
    webViewLink: typeof payload.webViewLink === "string" ? payload.webViewLink : undefined,
    size: typeof payload.size === "string" ? payload.size : undefined,
    md5Checksum: typeof payload.md5Checksum === "string" ? payload.md5Checksum : undefined,
    version: typeof payload.version === "string" ? payload.version : undefined,
    folderPath,
  } satisfies DriveItem;
}

function escapeDriveQuery(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

async function findDriveChild(accessToken: string, sharedDriveId: string, parentId: string, name: string, mimeType: string) {
  const params = new URLSearchParams({
    q: `'${escapeDriveQuery(parentId)}' in parents and name = '${escapeDriveQuery(name)}' and mimeType = '${escapeDriveQuery(mimeType)}' and trashed = false`,
    corpora: "drive",
    driveId: sharedDriveId,
    includeItemsFromAllDrives: "true",
    supportsAllDrives: "true",
    pageSize: "10",
    fields: "files(id,name,mimeType,modifiedTime,createdTime,parents,webViewLink,size,md5Checksum,version)",
  });
  const response = await fetch(`https://www.googleapis.com/drive/v3/files?${params}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const payload = await response.json().catch(() => ({})) as JsonRecord;
  if (!response.ok) throw new Error(`Google Drive search failed: ${driveError(payload, response.status).slice(0, 400)}`);
  const first = Array.isArray(payload.files) ? (payload.files as JsonRecord[])[0] : null;
  return first ? await driveFileMetadata(accessToken, String(first.id || "")) : null;
}

async function createDriveFolder(accessToken: string, parentId: string, name: string) {
  const response = await fetch("https://www.googleapis.com/drive/v3/files?supportsAllDrives=true&fields=id", {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ name, mimeType: "application/vnd.google-apps.folder", parents: [parentId] }),
  });
  const payload = await response.json().catch(() => ({})) as JsonRecord;
  if (!response.ok) throw new Error(`Google Drive folder creation failed: ${driveError(payload, response.status).slice(0, 400)}`);
  return await driveFileMetadata(accessToken, String(payload.id || ""));
}

async function createDriveTextFile(accessToken: string, parentId: string, name: string, contents: string) {
  const boundary = `rasika_${crypto.randomUUID().replace(/-/g, "")}`;
  const metadata = JSON.stringify({ name, mimeType: "text/plain", parents: [parentId] });
  const body = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n--${boundary}\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n${contents}\r\n--${boundary}--`;
  const response = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id", {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": `multipart/related; boundary=${boundary}` },
    body,
  });
  const payload = await response.json().catch(() => ({})) as JsonRecord;
  if (!response.ok) throw new Error(`Google Drive test file creation failed: ${driveError(payload, response.status).slice(0, 400)}`);
  return await driveFileMetadata(accessToken, String(payload.id || ""));
}

export async function provisionDriveConnectionTest(input: {
  sharedDriveId: string;
  projectFolderId: string;
  folderName: string;
  fileName: string;
  contents: string;
}) {
  const accessToken = await getDriveAccessToken();
  const parent = await driveFileMetadata(accessToken, input.projectFolderId);
  if (parent.mimeType !== "application/vnd.google-apps.folder") throw new Error("The configured project Drive target is not a folder");
  let folder = await findDriveChild(accessToken, input.sharedDriveId, parent.id, input.folderName, "application/vnd.google-apps.folder");
  const folderCreated = !folder;
  if (!folder) folder = await createDriveFolder(accessToken, parent.id, input.folderName);
  let file = await findDriveChild(accessToken, input.sharedDriveId, folder.id, input.fileName, "text/plain");
  const fileCreated = !file;
  if (!file) file = await createDriveTextFile(accessToken, folder.id, input.fileName, input.contents);
  return { folder, file, folderCreated, fileCreated } satisfies DriveConnectionTestResult;
}

export async function listProjectDriveTree(sharedDriveId: string, projectFolderId: string) {
  const accessToken = await getDriveAccessToken();
  const files: DriveItem[] = [];
  const folderItems: DriveItem[] = [];
  const folderQueue: Array<{ id: string; path: string }> = [{ id: projectFolderId, path: "" }];
  let cursor = 0;
  while (cursor < folderQueue.length) {
    if (folderQueue.length > 500 || files.length > 5000) throw new Error("Project Drive exceeds the safe first-slice inspection limit");
    const folder = folderQueue[cursor++];
    const children = await listDriveChildren(accessToken, sharedDriveId, folder.id, folder.path);
    for (const child of children) {
      if (child.mimeType === "application/vnd.google-apps.folder") {
        folderItems.push(child);
        folderQueue.push({ id: child.id, path: folder.path ? `${folder.path}/${child.name}` : child.name });
      } else {
        files.push(child);
      }
    }
  }
  return { files, folders: folderItems, folderCount: folderQueue.length };
}
