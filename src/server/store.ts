import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type {
  AccessScope,
  AdminUser,
  DashboardBootstrapInfo,
  DevicePlatform,
  PublicConsentDetails,
  RustDeskHandshakeManifest,
  RustDeskPublicConfig,
  SessionEvent,
  SessionStatus,
  SupportSession,
} from '../types/meridian.ts';

interface LocalAdminRecord {
  id: string;
  email: string;
  displayName: string;
  passwordHash: string;
  createdAt: string;
}

interface LocalStoreState {
  admins: LocalAdminRecord[];
  sessions: SupportSession[];
  rustdeskConfig: {
    hbbsHost: string;
    hbbrHost: string;
    publicKey: string;
    updatedAt: string | null;
  };
}

const DATA_DIR = path.resolve(process.cwd(), '.meridian-data');
const DATA_FILE = path.join(DATA_DIR, 'store.json');

const SUPABASE_URL = process.env.SUPABASE_URL?.trim() || process.env.VITE_SUPABASE_URL?.trim() || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || '';

let ephemeralSecret: string | null = null;
function getAuthSecret(): string {
  const envSecret = process.env.MERIDIAN_AUTH_SECRET?.trim();
  if (envSecret && envSecret.length >= 16) {
    return envSecret;
  }
  if (!ephemeralSecret) {
    const secretFile = path.join(DATA_DIR, '.auth-secret');
    try {
      if (fs.existsSync(secretFile)) {
        ephemeralSecret = fs.readFileSync(secretFile, 'utf8').trim();
      } else {
        fs.mkdirSync(DATA_DIR, { recursive: true });
        ephemeralSecret = crypto.randomBytes(32).toString('hex');
        fs.writeFileSync(secretFile, ephemeralSecret, { mode: 0o600 });
      }
    } catch {
      ephemeralSecret = crypto.randomBytes(32).toString('hex');
    }
  }
  return ephemeralSecret;
}

export function isSupabaseServerConfigured(): boolean {
  return (
    SUPABASE_URL.length > 0 &&
    SUPABASE_SERVICE_ROLE_KEY.length > 0 &&
    !SUPABASE_URL.includes('your-project.supabase.co') &&
    !SUPABASE_SERVICE_ROLE_KEY.includes('your-supabase-service-role-key')
  );
}

let cachedSupabaseAdmin: SupabaseClient | null = null;
function getSupabaseAdmin(): SupabaseClient | null {
  if (!isSupabaseServerConfigured()) return null;
  if (!cachedSupabaseAdmin) {
    cachedSupabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return cachedSupabaseAdmin;
}

function readLocalState(): LocalStoreState {
  const defaultState: LocalStoreState = {
    admins: [],
    sessions: [],
    rustdeskConfig: {
      hbbsHost: process.env.RUSTDESK_HBBS_HOST?.trim() || '',
      hbbrHost: process.env.RUSTDESK_HBBR_HOST?.trim() || '',
      publicKey: process.env.RUSTDESK_PUBLIC_KEY?.trim() || '',
      updatedAt: null,
    },
  };

  try {
    if (!fs.existsSync(DATA_FILE)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      fs.writeFileSync(DATA_FILE, JSON.stringify(defaultState, null, 2), { mode: 0o600 });
      return defaultState;
    }
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    const parsed = JSON.parse(raw) as Partial<LocalStoreState>;
    return {
      admins: Array.isArray(parsed.admins) ? parsed.admins : [],
      sessions: Array.isArray(parsed.sessions) ? parsed.sessions : [],
      rustdeskConfig: parsed.rustdeskConfig ?? defaultState.rustdeskConfig,
    };
  } catch {
    return defaultState;
  }
}

function writeLocalState(state: LocalStoreState): void {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(state, null, 2), { mode: 0o600 });
}

function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

function verifyPassword(password: string, storedHash: string): boolean {
  const [salt, keyHex] = storedHash.split(':');
  if (!salt || !keyHex) return false;
  const expected = Buffer.from(keyHex, 'hex');
  const actual = crypto.scryptSync(password, salt, 64);
  if (expected.length !== actual.length) return false;
  return crypto.timingSafeEqual(expected, actual);
}

function signLocalToken(user: AdminUser): string {
  const payload = {
    sub: user.id,
    email: user.email,
    displayName: user.displayName,
    role: user.role,
    exp: Date.now() + 1000 * 60 * 60 * 12,
  };
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', getAuthSecret()).update(body).digest('base64url');
  return `${body}.${sig}`;
}

function verifyLocalToken(token: string): AdminUser | null {
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const expectedSig = crypto.createHmac('sha256', getAuthSecret()).update(body).digest('base64url');
  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return null;
  }
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as {
      sub: string;
      email: string;
      displayName: string;
      role: 'admin';
      exp: number;
    };
    if (!payload.sub || !payload.email || Date.now() > payload.exp) {
      return null;
    }
    return {
      id: payload.sub,
      email: payload.email,
      displayName: payload.displayName,
      role: 'admin',
      authProvider: 'server_local',
    };
  } catch {
    return null;
  }
}

function makeEvent(
  sessionId: string,
  eventType: SessionEvent['eventType'],
  actor: string,
  summary: string
): SessionEvent {
  return {
    id: crypto.randomUUID(),
    sessionId,
    eventType,
    actor,
    summary,
    createdAt: new Date().toISOString(),
  };
}

function buildHandshakeManifest(
  platform: DevicePlatform,
  config: { hbbsHost: string; hbbrHost: string; publicKey: string },
  peerId: string | null
): RustDeskHandshakeManifest {
  const hbbsHost = config.hbbsHost.trim() || null;
  const hbbrHost = config.hbbrHost.trim() || null;
  const publicKey = config.publicKey.trim();
  const engineReady = Boolean(hbbsHost && hbbrHost && publicKey);
  const authorizationCode = `MRD-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;

  let launchUri: string | null = null;
  if (engineReady && peerId && hbbsHost) {
    const params = new URLSearchParams({ host: hbbsHost, key: publicKey, auth: authorizationCode });
    launchUri = `rustdesk://connection/new/${encodeURIComponent(peerId)}?${params.toString()}`;
  }

  return {
    engineReady,
    engineState: engineReady ? 'authorized_for_handoff' : 'awaiting_relay_config',
    hbbsHost,
    hbbrHost,
    publicKeyFingerprint: publicKey
      ? publicKey.length > 16
        ? `${publicKey.slice(0, 8)}...${publicKey.slice(-8)}`
        : publicKey
      : null,
    authorizationCode,
    targetPlatform: platform,
    launchUri,
    notes: engineReady
      ? 'Recipient explicitly granted access. Authorized RustDesk relay handoff parameters issued.'
      : 'Recipient explicitly granted access. Live screen streaming awaits a configured RustDesk hbbs/hbbr relay server.',
  };
}

function applyExpiryCheck(session: SupportSession): { session: SupportSession; changed: boolean } {
  const isActiveState = session.status === 'pending_consent' || session.status === 'approved';
  if (isActiveState && Date.now() > Date.parse(session.expiresAt)) {
    const expiredAt = new Date().toISOString();
    const updated: SupportSession = {
      ...session,
      status: 'expired',
      endedAt: session.endedAt ?? expiredAt,
      endedBy: session.endedBy ?? 'system_expiration',
      events: [
        ...session.events,
        makeEvent(
          session.id,
          'session_expired',
          'system',
          `Temporary link expired automatically after ${session.ttlMinutes} minutes.`
        ),
      ],
    };
    return { session: updated, changed: true };
  }
  return { session, changed: false };
}

export async function getBootstrapInfo(): Promise<DashboardBootstrapInfo> {
  const supabaseConfigured = isSupabaseServerConfigured();
  if (supabaseConfigured) {
    return {
      authMode: 'supabase',
      supabaseConfigured: true,
      requiresInitialAdminSetup: false,
      deploymentRuntime: 'node_express',
    };
  }
  const state = readLocalState();
  return {
    authMode: 'server_local',
    supabaseConfigured: false,
    requiresInitialAdminSetup: state.admins.length === 0,
    deploymentRuntime: 'node_express',
  };
}

export async function registerInitialAdmin(
  email: string,
  password: string,
  displayName: string
): Promise<{ user: AdminUser; token: string }> {
  const cleanEmail = email.trim().toLowerCase();
  const cleanName = displayName.trim() || cleanEmail.split('@')[0];
  if (!cleanEmail.includes('@') || password.length < 8) {
    throw new Error('Provide a valid email address and a password with at least 8 characters.');
  }

  if (isSupabaseServerConfigured()) {
    throw new Error('Supabase Auth is active. Register admin users through Supabase Authentication.');
  }

  const state = readLocalState();
  if (state.admins.length > 0) {
    throw new Error('An administrator account already exists. Please sign in with your credentials.');
  }

  const record: LocalAdminRecord = {
    id: crypto.randomUUID(),
    email: cleanEmail,
    displayName: cleanName,
    passwordHash: hashPassword(password),
    createdAt: new Date().toISOString(),
  };
  state.admins.push(record);
  writeLocalState(state);

  const user: AdminUser = {
    id: record.id,
    email: record.email,
    displayName: record.displayName,
    role: 'admin',
    authProvider: 'server_local',
  };
  return { user, token: signLocalToken(user) };
}

export async function loginLocalAdmin(
  email: string,
  password: string
): Promise<{ user: AdminUser; token: string }> {
  if (isSupabaseServerConfigured()) {
    throw new Error('Supabase Auth is active. Sign in via Supabase client authentication.');
  }
  const cleanEmail = email.trim().toLowerCase();
  const state = readLocalState();
  const found = state.admins.find((a) => a.email === cleanEmail);
  if (!found || !verifyPassword(password, found.passwordHash)) {
    throw new Error('Invalid email or password.');
  }

  const user: AdminUser = {
    id: found.id,
    email: found.email,
    displayName: found.displayName,
    role: 'admin',
    authProvider: 'server_local',
  };
  return { user, token: signLocalToken(user) };
}

export async function authenticateBearerToken(authHeader?: string): Promise<AdminUser | null> {
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }
  const token = authHeader.slice('Bearer '.length).trim();
  if (!token) return null;

  const sb = getSupabaseAdmin();
  if (sb) {
    const { data, error } = await sb.auth.getUser(token);
    if (error || !data.user || !data.user.email) {
      return null;
    }
    const metaName =
      typeof data.user.user_metadata?.display_name === 'string'
        ? data.user.user_metadata.display_name
        : data.user.email.split('@')[0];
    return {
      id: data.user.id,
      email: data.user.email,
      displayName: metaName,
      role: 'admin',
      authProvider: 'supabase',
    };
  }

  return verifyLocalToken(token);
}

function mapSupabaseSessionRow(
  row: Record<string, unknown>,
  events: SessionEvent[]
): SupportSession {
  return {
    id: String(row.id),
    token: String(row.token),
    adminId: String(row.admin_id),
    adminEmail: String(row.admin_email),
    recipientLabel: String(row.recipient_label),
    platform: row.platform as DevicePlatform,
    accessScope: row.access_scope as AccessScope,
    status: row.status as SessionStatus,
    ttlMinutes: Number(row.ttl_minutes),
    createdAt: String(row.created_at),
    expiresAt: String(row.expires_at),
    respondedAt: row.responded_at ? String(row.responded_at) : null,
    endedAt: row.ended_at ? String(row.ended_at) : null,
    endedBy: row.ended_by ? String(row.ended_by) : null,
    consentNote: row.consent_note ? String(row.consent_note) : null,
    rustdeskPeerId: row.rustdesk_peer_id ? String(row.rustdesk_peer_id) : null,
    handshakeManifest: (row.handshake_manifest as RustDeskHandshakeManifest | null) ?? null,
    events,
  };
}

export async function listSessionsForAdmin(admin: AdminUser): Promise<SupportSession[]> {
  const sb = getSupabaseAdmin();
  if (sb) {
    const { data: rows, error } = await sb
      .from('support_sessions')
      .select('*')
      .eq('admin_id', admin.id)
      .order('created_at', { ascending: false });

    if (error) throw new Error('Unable to load support sessions from Supabase.');

    const sessionIds = (rows ?? []).map((r) => String(r.id));
    let eventsBySession: Record<string, SessionEvent[]> = {};
    if (sessionIds.length > 0) {
      const { data: eventRows } = await sb
        .from('session_events')
        .select('*')
        .in('session_id', sessionIds)
        .order('created_at', { ascending: true });

      for (const ev of eventRows ?? []) {
        const sid = String(ev.session_id);
        if (!eventsBySession[sid]) eventsBySession[sid] = [];
        eventsBySession[sid].push({
          id: String(ev.id),
          sessionId: sid,
          eventType: ev.event_type as SessionEvent['eventType'],
          actor: String(ev.actor),
          summary: String(ev.summary),
          createdAt: String(ev.created_at),
        });
      }
    }

    const mapped: SupportSession[] = [];
    for (const row of rows ?? []) {
      const session = mapSupabaseSessionRow(row, eventsBySession[String(row.id)] ?? []);
      const checked = applyExpiryCheck(session);
      if (checked.changed) {
        await sb
          .from('support_sessions')
          .update({
            status: 'expired',
            ended_at: checked.session.endedAt,
            ended_by: checked.session.endedBy,
          })
          .eq('id', session.id);
        const latestEvent = checked.session.events[checked.session.events.length - 1];
        if (latestEvent) {
          await sb.from('session_events').insert({
            id: latestEvent.id,
            session_id: session.id,
            event_type: latestEvent.eventType,
            actor: latestEvent.actor,
            summary: latestEvent.summary,
            created_at: latestEvent.createdAt,
          });
        }
      }
      mapped.push(checked.session);
    }
    return mapped;
  }

  const state = readLocalState();
  let mutated = false;
  const adminSessions = state.sessions
    .map((s) => {
      const checked = applyExpiryCheck(s);
      if (checked.changed) mutated = true;
      return checked.session;
    })
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));

  if (mutated) {
    state.sessions = adminSessions;
    writeLocalState(state);
  }
  return adminSessions.filter((s) => s.adminId === admin.id);
}

export async function createInvitation(
  admin: AdminUser,
  input: {
    platform: DevicePlatform;
    recipientLabel: string;
    ttlMinutes: number;
    accessScope: AccessScope;
  }
): Promise<SupportSession> {
  const ttlMinutes = Math.max(5, Math.min(1440, Math.round(input.ttlMinutes || 30)));
  const recipientLabel = input.recipientLabel.trim() || `${input.platform === 'windows' ? 'Windows' : 'Android'} Support Device`;
  const now = new Date();
  const expiresAt = new Date(now.getTime() + ttlMinutes * 60_000).toISOString();
  const id = crypto.randomUUID();
  const token = crypto.randomBytes(24).toString('base64url');
  const initialEvent = makeEvent(
    id,
    'invitation_created',
    admin.email,
    `Created temporary ${input.platform === 'windows' ? 'Windows' : 'Android'} invitation link (expires in ${ttlMinutes}m).`
  );

  const session: SupportSession = {
    id,
    token,
    adminId: admin.id,
    adminEmail: admin.email,
    recipientLabel,
    platform: input.platform,
    accessScope: input.accessScope,
    status: 'pending_consent',
    ttlMinutes,
    createdAt: now.toISOString(),
    expiresAt,
    respondedAt: null,
    endedAt: null,
    endedBy: null,
    consentNote: null,
    rustdeskPeerId: null,
    handshakeManifest: null,
    events: [initialEvent],
  };

  const sb = getSupabaseAdmin();
  if (sb) {
    await sb.from('admin_profiles').upsert(
      {
        id: admin.id,
        email: admin.email,
        display_name: admin.displayName,
        role: 'admin',
      },
      { onConflict: 'id' }
    );

    const { error } = await sb.from('support_sessions').insert({
      id: session.id,
      token: session.token,
      admin_id: session.adminId,
      admin_email: session.adminEmail,
      recipient_label: session.recipientLabel,
      platform: session.platform,
      access_scope: session.accessScope,
      status: session.status,
      ttl_minutes: session.ttlMinutes,
      created_at: session.createdAt,
      expires_at: session.expiresAt,
    });
    if (error) {
      throw new Error('Failed to persist invitation in Supabase.');
    }
    await sb.from('session_events').insert({
      id: initialEvent.id,
      session_id: session.id,
      event_type: initialEvent.eventType,
      actor: initialEvent.actor,
      summary: initialEvent.summary,
      created_at: initialEvent.createdAt,
    });
    return session;
  }

  const state = readLocalState();
  state.sessions.unshift(session);
  writeLocalState(state);
  return session;
}

export async function recordLinkCopied(
  admin: AdminUser,
  sessionId: string
): Promise<SupportSession | null> {
  const sb = getSupabaseAdmin();
  if (sb) {
    const { data: row } = await sb
      .from('support_sessions')
      .select('id')
      .eq('id', sessionId)
      .eq('admin_id', admin.id)
      .maybeSingle();
    if (!row) return null;
    const ev = makeEvent(sessionId, 'link_copied', admin.email, 'Invitation link copied for recipient delivery.');
    await sb.from('session_events').insert({
      id: ev.id,
      session_id: sessionId,
      event_type: ev.eventType,
      actor: ev.actor,
      summary: ev.summary,
      created_at: ev.createdAt,
    });
    const sessions = await listSessionsForAdmin(admin);
    return sessions.find((s) => s.id === sessionId) ?? null;
  }

  const state = readLocalState();
  const idx = state.sessions.findIndex((s) => s.id === sessionId && s.adminId === admin.id);
  if (idx === -1) return null;
  const ev = makeEvent(sessionId, 'link_copied', admin.email, 'Invitation link copied for recipient delivery.');
  state.sessions[idx].events.push(ev);
  writeLocalState(state);
  return state.sessions[idx];
}

export async function endSessionByAdmin(
  admin: AdminUser,
  sessionId: string
): Promise<SupportSession | null> {
  const now = new Date().toISOString();
  const sb = getSupabaseAdmin();
  if (sb) {
    const { data: existing } = await sb
      .from('support_sessions')
      .select('*')
      .eq('id', sessionId)
      .eq('admin_id', admin.id)
      .maybeSingle();
    if (!existing) return null;
    if (existing.status === 'ended' || existing.status === 'rejected' || existing.status === 'expired') {
      const sessions = await listSessionsForAdmin(admin);
      return sessions.find((s) => s.id === sessionId) ?? null;
    }

    await sb
      .from('support_sessions')
      .update({
        status: 'ended',
        ended_at: now,
        ended_by: admin.email,
      })
      .eq('id', sessionId);

    const ev = makeEvent(sessionId, 'session_ended', admin.email, 'Support session ended by administrator.');
    await sb.from('session_events').insert({
      id: ev.id,
      session_id: sessionId,
      event_type: ev.eventType,
      actor: ev.actor,
      summary: ev.summary,
      created_at: ev.createdAt,
    });

    const sessions = await listSessionsForAdmin(admin);
    return sessions.find((s) => s.id === sessionId) ?? null;
  }

  const state = readLocalState();
  const idx = state.sessions.findIndex((s) => s.id === sessionId && s.adminId === admin.id);
  if (idx === -1) return null;
  const current = applyExpiryCheck(state.sessions[idx]).session;
  if (current.status === 'ended' || current.status === 'rejected' || current.status === 'expired') {
    state.sessions[idx] = current;
    writeLocalState(state);
    return current;
  }
  const ev = makeEvent(sessionId, 'session_ended', admin.email, 'Support session ended by administrator.');
  state.sessions[idx] = {
    ...current,
    status: 'ended',
    endedAt: now,
    endedBy: admin.email,
    events: [...current.events, ev],
  };
  writeLocalState(state);
  return state.sessions[idx];
}

export async function getRustDeskPublicConfig(): Promise<RustDeskPublicConfig> {
  const hasServerApiKey = Boolean(process.env.RUSTDESK_API_KEY?.trim());
  const sb = getSupabaseAdmin();
  if (sb) {
    const { data } = await sb.from('rustdesk_configs').select('*').eq('id', 'default').maybeSingle();
    const hbbsHost = (data?.hbbs_host as string) || process.env.RUSTDESK_HBBS_HOST?.trim() || '';
    const hbbrHost = (data?.hbbr_host as string) || process.env.RUSTDESK_HBBR_HOST?.trim() || '';
    const publicKey = (data?.public_key as string) || process.env.RUSTDESK_PUBLIC_KEY?.trim() || '';
    return {
      configured: Boolean(hbbsHost && hbbrHost && publicKey),
      hbbsHost,
      hbbrHost,
      publicKey,
      hasServerApiKey,
      deploymentTarget: 'node_express',
      updatedAt: data?.updated_at ? String(data.updated_at) : null,
    };
  }

  const state = readLocalState();
  const cfg = state.rustdeskConfig;
  return {
    configured: Boolean(cfg.hbbsHost && cfg.hbbrHost && cfg.publicKey),
    hbbsHost: cfg.hbbsHost,
    hbbrHost: cfg.hbbrHost,
    publicKey: cfg.publicKey,
    hasServerApiKey,
    deploymentTarget: 'node_express',
    updatedAt: cfg.updatedAt,
  };
}

export async function updateRustDeskConfig(
  admin: AdminUser,
  input: { hbbsHost: string; hbbrHost: string; publicKey: string }
): Promise<RustDeskPublicConfig> {
  const now = new Date().toISOString();
  const hbbsHost = input.hbbsHost.trim();
  const hbbrHost = input.hbbrHost.trim();
  const publicKey = input.publicKey.trim();

  const sb = getSupabaseAdmin();
  if (sb) {
    await sb.from('rustdesk_configs').upsert(
      {
        id: 'default',
        hbbs_host: hbbsHost,
        hbbr_host: hbbrHost,
        public_key: publicKey,
        updated_by: admin.id,
        updated_at: now,
      },
      { onConflict: 'id' }
    );
    return getRustDeskPublicConfig();
  }

  const state = readLocalState();
  state.rustdeskConfig = {
    hbbsHost,
    hbbrHost,
    publicKey,
    updatedAt: now,
  };
  writeLocalState(state);
  return getRustDeskPublicConfig();
}

export async function getPublicConsentDetails(token: string): Promise<PublicConsentDetails | null> {
  const sb = getSupabaseAdmin();
  if (sb) {
    const { data: row } = await sb
      .from('support_sessions')
      .select('*')
      .eq('token', token)
      .maybeSingle();
    if (!row) return null;
    const session = applyExpiryCheck(mapSupabaseSessionRow(row, [])).session;
    if (session.status === 'expired' && row.status !== 'expired') {
      await sb
        .from('support_sessions')
        .update({
          status: 'expired',
          ended_at: session.endedAt,
          ended_by: session.endedBy,
        })
        .eq('id', session.id);
    }
    return {
      sessionId: session.id,
      organizationName: 'MERIDIAN Remote Access',
      adminEmail: session.adminEmail,
      recipientLabel: session.recipientLabel,
      platform: session.platform,
      accessScope: session.accessScope,
      status: session.status,
      createdAt: session.createdAt,
      expiresAt: session.expiresAt,
      respondedAt: session.respondedAt,
      endedAt: session.endedAt,
      handshakeManifest: session.handshakeManifest,
    };
  }

  const state = readLocalState();
  const idx = state.sessions.findIndex((s) => s.token === token);
  if (idx === -1) return null;
  const checked = applyExpiryCheck(state.sessions[idx]);
  if (checked.changed) {
    state.sessions[idx] = checked.session;
    writeLocalState(state);
  }
  const s = checked.session;
  return {
    sessionId: s.id,
    organizationName: 'MERIDIAN Remote Access',
    adminEmail: s.adminEmail,
    recipientLabel: s.recipientLabel,
    platform: s.platform,
    accessScope: s.accessScope,
    status: s.status,
    createdAt: s.createdAt,
    expiresAt: s.expiresAt,
    respondedAt: s.respondedAt,
    endedAt: s.endedAt,
    handshakeManifest: s.handshakeManifest,
  };
}

export async function respondToConsent(
  token: string,
  decision: 'allow' | 'reject' | 'end',
  rustdeskPeerId?: string
): Promise<PublicConsentDetails | null> {
  const now = new Date().toISOString();
  const cleanPeerId = rustdeskPeerId?.trim() ? rustdeskPeerId.trim().slice(0, 64) : null;
  const relayCfg = await getRustDeskPublicConfig();

  const sb = getSupabaseAdmin();
  if (sb) {
    const { data: row } = await sb
      .from('support_sessions')
      .select('*')
      .eq('token', token)
      .maybeSingle();
    if (!row) return null;

    const current = applyExpiryCheck(mapSupabaseSessionRow(row, [])).session;
    if (current.status === 'expired' || current.status === 'ended' || current.status === 'rejected') {
      if (current.status === 'expired' && row.status !== 'expired') {
        await sb
          .from('support_sessions')
          .update({ status: 'expired', ended_at: current.endedAt, ended_by: current.endedBy })
          .eq('id', current.id);
      }
      return getPublicConsentDetails(token);
    }

    if (decision === 'end') {
      await sb
        .from('support_sessions')
        .update({ status: 'ended', ended_at: now, ended_by: 'recipient' })
        .eq('id', current.id);
      const ev = makeEvent(current.id, 'session_ended', 'recipient', 'Recipient ended the authorized session.');
      await sb.from('session_events').insert({
        id: ev.id,
        session_id: current.id,
        event_type: ev.eventType,
        actor: ev.actor,
        summary: ev.summary,
        created_at: ev.createdAt,
      });
      return getPublicConsentDetails(token);
    }

    if (current.status !== 'pending_consent') {
      return getPublicConsentDetails(token);
    }

    if (decision === 'reject') {
      await sb
        .from('support_sessions')
        .update({
          status: 'rejected',
          responded_at: now,
          ended_at: now,
          ended_by: 'recipient',
        })
        .eq('id', current.id);
      const ev = makeEvent(
        current.id,
        'consent_rejected',
        'recipient',
        'Recipient declined the remote access invitation.'
      );
      await sb.from('session_events').insert({
        id: ev.id,
        session_id: current.id,
        event_type: ev.eventType,
        actor: ev.actor,
        summary: ev.summary,
        created_at: ev.createdAt,
      });
      return getPublicConsentDetails(token);
    }

    const manifest = buildHandshakeManifest(current.platform, relayCfg, cleanPeerId);
    await sb
      .from('support_sessions')
      .update({
        status: 'approved',
        responded_at: now,
        rustdesk_peer_id: cleanPeerId,
        handshake_manifest: manifest,
      })
      .eq('id', current.id);

    const consentEv = makeEvent(
      current.id,
      'consent_allowed',
      'recipient',
      `Recipient explicitly allowed ${current.accessScope === 'view_only' ? 'view-only' : 'assisted'} support.`
    );
    const handshakeEv = makeEvent(
      current.id,
      'rustdesk_handshake_prepared',
      'system',
      manifest.notes
    );
    await sb.from('session_events').insert([
      {
        id: consentEv.id,
        session_id: current.id,
        event_type: consentEv.eventType,
        actor: consentEv.actor,
        summary: consentEv.summary,
        created_at: consentEv.createdAt,
      },
      {
        id: handshakeEv.id,
        session_id: current.id,
        event_type: handshakeEv.eventType,
        actor: handshakeEv.actor,
        summary: handshakeEv.summary,
        created_at: handshakeEv.createdAt,
      },
    ]);

    return getPublicConsentDetails(token);
  }

  const state = readLocalState();
  const idx = state.sessions.findIndex((s) => s.token === token);
  if (idx === -1) return null;

  const current = applyExpiryCheck(state.sessions[idx]).session;
  state.sessions[idx] = current;

  if (current.status === 'expired' || current.status === 'ended' || current.status === 'rejected') {
    writeLocalState(state);
    return getPublicConsentDetails(token);
  }

  if (decision === 'end') {
    const ev = makeEvent(current.id, 'session_ended', 'recipient', 'Recipient ended the authorized session.');
    state.sessions[idx] = {
      ...current,
      status: 'ended',
      endedAt: now,
      endedBy: 'recipient',
      events: [...current.events, ev],
    };
    writeLocalState(state);
    return getPublicConsentDetails(token);
  }

  if (current.status !== 'pending_consent') {
    return getPublicConsentDetails(token);
  }

  if (decision === 'reject') {
    const ev = makeEvent(
      current.id,
      'consent_rejected',
      'recipient',
      'Recipient declined the remote access invitation.'
    );
    state.sessions[idx] = {
      ...current,
      status: 'rejected',
      respondedAt: now,
      endedAt: now,
      endedBy: 'recipient',
      events: [...current.events, ev],
    };
    writeLocalState(state);
    return getPublicConsentDetails(token);
  }

  const manifest = buildHandshakeManifest(current.platform, relayCfg, cleanPeerId);
  const consentEv = makeEvent(
    current.id,
    'consent_allowed',
    'recipient',
    `Recipient explicitly allowed ${current.accessScope === 'view_only' ? 'view-only' : 'assisted'} support.`
  );
  const handshakeEv = makeEvent(
    current.id,
    'rustdesk_handshake_prepared',
    'system',
    manifest.notes
  );

  state.sessions[idx] = {
    ...current,
    status: 'approved',
    respondedAt: now,
    rustdeskPeerId: cleanPeerId,
    handshakeManifest: manifest,
    events: [...current.events, consentEv, handshakeEv],
  };
  writeLocalState(state);
  return getPublicConsentDetails(token);
}
