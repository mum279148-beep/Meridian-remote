// Shared Web Standard /api/* router for Cloudflare Workers and Cloudflare Pages Functions.
// Uses Supabase Auth JWT verification + Supabase PostgREST with server-only SUPABASE_SERVICE_ROLE_KEY.

export interface CloudflareEnv {
  SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  RUSTDESK_HBBS_HOST?: string;
  RUSTDESK_HBBR_HOST?: string;
  RUSTDESK_PUBLIC_KEY?: string;
  RUSTDESK_API_KEY?: string;
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}

function randomToken(bytes = 24): string {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return btoa(String.fromCharCode(...arr))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function mapSessionRow(
  row: Record<string, unknown>,
  events: Array<Record<string, unknown>> = []
) {
  return {
    id: String(row.id),
    token: String(row.token),
    adminId: String(row.admin_id),
    adminEmail: String(row.admin_email),
    recipientLabel: String(row.recipient_label),
    platform: String(row.platform),
    accessScope: String(row.access_scope),
    status: String(row.status),
    ttlMinutes: Number(row.ttl_minutes),
    createdAt: String(row.created_at),
    expiresAt: String(row.expires_at),
    respondedAt: row.responded_at ? String(row.responded_at) : null,
    endedAt: row.ended_at ? String(row.ended_at) : null,
    endedBy: row.ended_by ? String(row.ended_by) : null,
    consentNote: row.consent_note ? String(row.consent_note) : null,
    rustdeskPeerId: row.rustdesk_peer_id ? String(row.rustdesk_peer_id) : null,
    handshakeManifest: row.handshake_manifest ?? null,
    events: events.map((ev) => ({
      id: String(ev.id),
      sessionId: String(ev.session_id),
      eventType: String(ev.event_type),
      actor: String(ev.actor),
      summary: String(ev.summary),
      createdAt: String(ev.created_at),
    })),
  };
}

async function verifySupabaseJwt(
  env: CloudflareEnv,
  authHeader: string | null
): Promise<{ id: string; email: string; displayName: string } | null> {
  if (!authHeader?.startsWith('Bearer ') || !env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    return null;
  }
  const token = authHeader.slice(7).trim();
  const res = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      authorization: `Bearer ${token}`,
    },
  });
  if (!res.ok) return null;
  const user = (await res.json()) as {
    id?: string;
    email?: string;
    user_metadata?: { display_name?: string };
  };
  if (!user.id || !user.email) return null;
  return {
    id: user.id,
    email: user.email,
    displayName: user.user_metadata?.display_name || user.email.split('@')[0],
  };
}

async function sbRest(
  env: CloudflareEnv,
  pathWithQuery: string,
  init: RequestInit = {}
): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set('apikey', env.SUPABASE_SERVICE_ROLE_KEY || '');
  headers.set('authorization', `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY || ''}`);
  if (!headers.has('content-type') && init.body) {
    headers.set('content-type', 'application/json');
  }
  return fetch(`${env.SUPABASE_URL}/rest/v1/${pathWithQuery}`, {
    ...init,
    headers,
  });
}

async function getRelayConfig(env: CloudflareEnv) {
  const cfgRes = await sbRest(env, `rustdesk_configs?id=eq.default&select=*&limit=1`);
  const cfgRows = (await cfgRes.json().catch(() => [])) as Array<Record<string, unknown>>;
  const row = cfgRows[0];
  const hbbsHost = String(row?.hbbs_host || env.RUSTDESK_HBBS_HOST || '').trim();
  const hbbrHost = String(row?.hbbr_host || env.RUSTDESK_HBBR_HOST || '').trim();
  const publicKey = String(row?.public_key || env.RUSTDESK_PUBLIC_KEY || '').trim();
  return {
    configured: Boolean(hbbsHost && hbbrHost && publicKey),
    hbbsHost,
    hbbrHost,
    publicKey,
    hasServerApiKey: Boolean(env.RUSTDESK_API_KEY?.trim()),
    deploymentTarget: 'cloudflare_pages' as const,
    updatedAt: row?.updated_at ? String(row.updated_at) : null,
  };
}

export async function handleCloudflareApiRequest(
  request: Request,
  env: CloudflareEnv,
  runtimeName: 'cloudflare_workers' | 'cloudflare_pages'
): Promise<Response> {
  const url = new URL(request.url);
  const subPath = url.pathname.replace(/^\/api\/?/, '');
  const method = request.method.toUpperCase();

  if (subPath === 'bootstrap' && method === 'GET') {
    const supabaseConfigured = Boolean(env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY);
    return json({
      authMode: 'supabase',
      supabaseConfigured,
      requiresInitialAdminSetup: false,
      deploymentRuntime: runtimeName,
    });
  }

  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    return json(
      {
        error:
          'Cloudflare deployment requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY secrets in Environment Variables.',
      },
      503
    );
  }

  // Public consent lookup
  if (subPath.startsWith('consent/') && !subPath.endsWith('/respond') && method === 'GET') {
    const token = decodeURIComponent(subPath.slice('consent/'.length));
    const res = await sbRest(
      env,
      `support_sessions?token=eq.${encodeURIComponent(token)}&select=*&limit=1`
    );
    const rows = (await res.json()) as Array<Record<string, unknown>>;
    const row = rows[0];
    if (!row) return json({ error: 'This invitation link is invalid or no longer exists.' }, 404);

    let status = String(row.status);
    let endedAt = row.ended_at ? String(row.ended_at) : null;
    if (
      (status === 'pending_consent' || status === 'approved') &&
      Date.now() > Date.parse(String(row.expires_at))
    ) {
      status = 'expired';
      endedAt = new Date().toISOString();
      await sbRest(env, `support_sessions?id=eq.${row.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          status: 'expired',
          ended_at: endedAt,
          ended_by: 'system_expiration',
        }),
      });
    }

    return json({
      sessionId: row.id,
      organizationName: 'MERIDIAN Remote Access',
      adminEmail: row.admin_email,
      recipientLabel: row.recipient_label,
      platform: row.platform,
      accessScope: row.access_scope,
      status,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
      respondedAt: row.responded_at,
      endedAt,
      handshakeManifest: row.handshake_manifest ?? null,
    });
  }

  // Public consent response
  if (subPath.startsWith('consent/') && subPath.endsWith('/respond') && method === 'POST') {
    const token = decodeURIComponent(subPath.slice('consent/'.length, -'/respond'.length));
    const body = (await request.json().catch(() => ({}))) as {
      decision?: 'allow' | 'reject' | 'end';
      rustdeskPeerId?: string;
    };
    const res = await sbRest(
      env,
      `support_sessions?token=eq.${encodeURIComponent(token)}&select=*&limit=1`
    );
    const rows = (await res.json()) as Array<Record<string, unknown>>;
    const row = rows[0];
    if (!row) return json({ error: 'Invitation link not found.' }, 404);

    const now = new Date().toISOString();
    const isExpired = Date.now() > Date.parse(String(row.expires_at));
    if (isExpired && (row.status === 'pending_consent' || row.status === 'approved')) {
      await sbRest(env, `support_sessions?id=eq.${row.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'expired', ended_at: now, ended_by: 'system_expiration' }),
      });
      return json({
        sessionId: row.id,
        organizationName: 'MERIDIAN Remote Access',
        adminEmail: row.admin_email,
        recipientLabel: row.recipient_label,
        platform: row.platform,
        accessScope: row.access_scope,
        status: 'expired',
        createdAt: row.created_at,
        expiresAt: row.expires_at,
        respondedAt: row.responded_at,
        endedAt: now,
        handshakeManifest: row.handshake_manifest ?? null,
      });
    }

    if (body.decision === 'end') {
      await sbRest(env, `support_sessions?id=eq.${row.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'ended', ended_at: now, ended_by: 'recipient' }),
      });
      await sbRest(env, 'session_events', {
        method: 'POST',
        body: JSON.stringify({
          id: crypto.randomUUID(),
          session_id: row.id,
          event_type: 'session_ended',
          actor: 'recipient',
          summary: 'Recipient ended the authorized session.',
          created_at: now,
        }),
      });
      return json({
        sessionId: row.id,
        organizationName: 'MERIDIAN Remote Access',
        adminEmail: row.admin_email,
        recipientLabel: row.recipient_label,
        platform: row.platform,
        accessScope: row.access_scope,
        status: 'ended',
        createdAt: row.created_at,
        expiresAt: row.expires_at,
        respondedAt: row.responded_at,
        endedAt: now,
        handshakeManifest: row.handshake_manifest ?? null,
      });
    }

    if (row.status !== 'pending_consent') {
      return json({
        sessionId: row.id,
        organizationName: 'MERIDIAN Remote Access',
        adminEmail: row.admin_email,
        recipientLabel: row.recipient_label,
        platform: row.platform,
        accessScope: row.access_scope,
        status: row.status,
        createdAt: row.created_at,
        expiresAt: row.expires_at,
        respondedAt: row.responded_at,
        endedAt: row.ended_at,
        handshakeManifest: row.handshake_manifest ?? null,
      });
    }

    if (body.decision === 'reject') {
      await sbRest(env, `support_sessions?id=eq.${row.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          status: 'rejected',
          responded_at: now,
          ended_at: now,
          ended_by: 'recipient',
        }),
      });
      await sbRest(env, 'session_events', {
        method: 'POST',
        body: JSON.stringify({
          id: crypto.randomUUID(),
          session_id: row.id,
          event_type: 'consent_rejected',
          actor: 'recipient',
          summary: 'Recipient declined the remote access invitation.',
          created_at: now,
        }),
      });
      return json({
        sessionId: row.id,
        organizationName: 'MERIDIAN Remote Access',
        adminEmail: row.admin_email,
        recipientLabel: row.recipient_label,
        platform: row.platform,
        accessScope: row.access_scope,
        status: 'rejected',
        createdAt: row.created_at,
        expiresAt: row.expires_at,
        respondedAt: now,
        endedAt: now,
        handshakeManifest: null,
      });
    }

    const relay = await getRelayConfig(env);
    const engineReady = relay.configured;
    const authCode = `MRD-${randomToken(4).toUpperCase().slice(0, 8)}`;
    const peerId = body.rustdeskPeerId?.trim().slice(0, 64) || null;

    const manifest = {
      engineReady,
      engineState: engineReady ? 'authorized_for_handoff' : 'awaiting_relay_config',
      hbbsHost: relay.hbbsHost || null,
      hbbrHost: relay.hbbrHost || null,
      publicKeyFingerprint: relay.publicKey
        ? relay.publicKey.length > 16
          ? `${relay.publicKey.slice(0, 8)}...${relay.publicKey.slice(-8)}`
          : relay.publicKey
        : null,
      authorizationCode: authCode,
      targetPlatform: row.platform,
      launchUri:
        engineReady && peerId && relay.hbbsHost
          ? `rustdesk://connection/new/${encodeURIComponent(peerId)}?host=${encodeURIComponent(relay.hbbsHost)}&key=${encodeURIComponent(relay.publicKey)}&auth=${encodeURIComponent(authCode)}`
          : null,
      notes: engineReady
        ? 'Recipient explicitly granted access. Authorized RustDesk relay handoff parameters issued.'
        : 'Recipient explicitly granted access. Live screen streaming awaits a configured RustDesk hbbs/hbbr relay server.',
    };

    await sbRest(env, `support_sessions?id=eq.${row.id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        status: 'approved',
        responded_at: now,
        rustdesk_peer_id: peerId,
        handshake_manifest: manifest,
      }),
    });

    await sbRest(env, 'session_events', {
      method: 'POST',
      body: JSON.stringify([
        {
          id: crypto.randomUUID(),
          session_id: row.id,
          event_type: 'consent_allowed',
          actor: 'recipient',
          summary: 'Recipient explicitly allowed remote support.',
          created_at: now,
        },
        {
          id: crypto.randomUUID(),
          session_id: row.id,
          event_type: 'rustdesk_handshake_prepared',
          actor: 'system',
          summary: manifest.notes,
          created_at: now,
        },
      ]),
    });

    return json({
      sessionId: row.id,
      organizationName: 'MERIDIAN Remote Access',
      adminEmail: row.admin_email,
      recipientLabel: row.recipient_label,
      platform: row.platform,
      accessScope: row.access_scope,
      status: 'approved',
      createdAt: row.created_at,
      expiresAt: row.expires_at,
      respondedAt: now,
      endedAt: null,
      handshakeManifest: manifest,
    });
  }

  // Authenticated admin endpoints
  const admin = await verifySupabaseJwt(env, request.headers.get('authorization'));
  if (!admin) {
    return json({ error: 'Unauthorized: Valid admin session required.' }, 401);
  }

  if (subPath === 'auth/me' && method === 'GET') {
    return json({ user: { ...admin, role: 'admin', authProvider: 'supabase' } });
  }

  if (subPath === 'invitations' && method === 'GET') {
    const res = await sbRest(
      env,
      `support_sessions?admin_id=eq.${encodeURIComponent(admin.id)}&order=created_at.desc`
    );
    const rows = (await res.json()) as Array<Record<string, unknown>>;
    const ids = rows.map((r) => String(r.id));
    const eventsMap: Record<string, Array<Record<string, unknown>>> = {};

    if (ids.length > 0) {
      const evRes = await sbRest(
        env,
        `session_events?session_id=in.(${ids.map(encodeURIComponent).join(',')})&order=created_at.asc`
      );
      const evRows = (await evRes.json().catch(() => [])) as Array<Record<string, unknown>>;
      for (const ev of evRows) {
        const sid = String(ev.session_id);
        if (!eventsMap[sid]) eventsMap[sid] = [];
        eventsMap[sid].push(ev);
      }
    }

    const sessions = rows.map((row) => mapSessionRow(row, eventsMap[String(row.id)] ?? []));
    return json({ sessions });
  }

  if (subPath === 'invitations' && method === 'POST') {
    const body = (await request.json().catch(() => ({}))) as {
      platform?: 'windows' | 'android';
      recipientLabel?: string;
      ttlMinutes?: number;
      accessScope?: 'view_only' | 'assisted_control';
    };
    const ttlMinutes = Math.max(5, Math.min(1440, Number(body.ttlMinutes || 30)));
    const now = new Date();
    const expiresAt = new Date(now.getTime() + ttlMinutes * 60_000).toISOString();
    const id = crypto.randomUUID();
    const token = randomToken(24);
    const platform = body.platform === 'android' ? 'android' : 'windows';
    const accessScope = body.accessScope === 'view_only' ? 'view_only' : 'assisted_control';

    await sbRest(env, 'admin_profiles', {
      method: 'POST',
      headers: { prefer: 'resolution=merge-duplicates' },
      body: JSON.stringify({
        id: admin.id,
        email: admin.email,
        display_name: admin.displayName,
        role: 'admin',
      }),
    });

    const payload = {
      id,
      token,
      admin_id: admin.id,
      admin_email: admin.email,
      recipient_label:
        body.recipientLabel?.trim() || `${platform === 'windows' ? 'Windows' : 'Android'} Support Device`,
      platform,
      access_scope: accessScope,
      status: 'pending_consent',
      ttl_minutes: ttlMinutes,
      created_at: now.toISOString(),
      expires_at: expiresAt,
    };

    const res = await sbRest(env, 'support_sessions', {
      method: 'POST',
      headers: { prefer: 'return=representation' },
      body: JSON.stringify(payload),
    });
    const createdRows = (await res.json()) as Array<Record<string, unknown>>;
    const createdRow = createdRows[0] ?? payload;

    const initialEvent = {
      id: crypto.randomUUID(),
      session_id: id,
      event_type: 'invitation_created',
      actor: admin.email,
      summary: `Created temporary ${platform === 'windows' ? 'Windows' : 'Android'} invitation link (expires in ${ttlMinutes}m).`,
      created_at: now.toISOString(),
    };
    await sbRest(env, 'session_events', {
      method: 'POST',
      body: JSON.stringify(initialEvent),
    });

    return json({ session: mapSessionRow(createdRow, [initialEvent]) }, 201);
  }

  if (subPath.startsWith('sessions/') && subPath.endsWith('/copied') && method === 'POST') {
    const sessionId = decodeURIComponent(subPath.slice('sessions/'.length, -'/copied'.length));
    const ev = {
      id: crypto.randomUUID(),
      session_id: sessionId,
      event_type: 'link_copied',
      actor: admin.email,
      summary: 'Invitation link copied for recipient delivery.',
      created_at: new Date().toISOString(),
    };
    await sbRest(env, 'session_events', { method: 'POST', body: JSON.stringify(ev) });

    const sRes = await sbRest(
      env,
      `support_sessions?id=eq.${encodeURIComponent(sessionId)}&admin_id=eq.${encodeURIComponent(admin.id)}&limit=1`
    );
    const sRows = (await sRes.json()) as Array<Record<string, unknown>>;
    if (!sRows[0]) return json({ error: 'Session not found.' }, 404);
    const evRes = await sbRest(
      env,
      `session_events?session_id=eq.${encodeURIComponent(sessionId)}&order=created_at.asc`
    );
    const evRows = (await evRes.json().catch(() => [])) as Array<Record<string, unknown>>;
    return json({ session: mapSessionRow(sRows[0], evRows) });
  }

  if (subPath.startsWith('sessions/') && subPath.endsWith('/end') && method === 'POST') {
    const sessionId = decodeURIComponent(subPath.slice('sessions/'.length, -'/end'.length));
    const now = new Date().toISOString();
    await sbRest(
      env,
      `support_sessions?id=eq.${encodeURIComponent(sessionId)}&admin_id=eq.${encodeURIComponent(admin.id)}`,
      {
        method: 'PATCH',
        body: JSON.stringify({
          status: 'ended',
          ended_at: now,
          ended_by: admin.email,
        }),
      }
    );
    await sbRest(env, 'session_events', {
      method: 'POST',
      body: JSON.stringify({
        id: crypto.randomUUID(),
        session_id: sessionId,
        event_type: 'session_ended',
        actor: admin.email,
        summary: 'Support session ended by administrator.',
        created_at: now,
      }),
    });

    const sRes = await sbRest(
      env,
      `support_sessions?id=eq.${encodeURIComponent(sessionId)}&admin_id=eq.${encodeURIComponent(admin.id)}&limit=1`
    );
    const sRows = (await sRes.json()) as Array<Record<string, unknown>>;
    if (!sRows[0]) return json({ error: 'Session not found.' }, 404);
    const evRes = await sbRest(
      env,
      `session_events?session_id=eq.${encodeURIComponent(sessionId)}&order=created_at.asc`
    );
    const evRows = (await evRes.json().catch(() => [])) as Array<Record<string, unknown>>;
    return json({ session: mapSessionRow(sRows[0], evRows) });
  }

  if (subPath === 'rustdesk/config' && method === 'GET') {
    const config = await getRelayConfig(env);
    return json({ config });
  }

  if (subPath === 'rustdesk/config' && method === 'PUT') {
    const body = (await request.json().catch(() => ({}))) as {
      hbbsHost?: string;
      hbbrHost?: string;
      publicKey?: string;
    };
    await sbRest(env, 'rustdesk_configs', {
      method: 'POST',
      headers: { prefer: 'resolution=merge-duplicates' },
      body: JSON.stringify({
        id: 'default',
        hbbs_host: String(body.hbbsHost ?? '').trim(),
        hbbr_host: String(body.hbbrHost ?? '').trim(),
        public_key: String(body.publicKey ?? '').trim(),
        updated_by: admin.id,
        updated_at: new Date().toISOString(),
      }),
    });
    const config = await getRelayConfig(env);
    return json({ config });
  }

  return json({ error: 'API route not found' }, 404);
}
