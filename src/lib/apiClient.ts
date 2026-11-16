import type {
  AccessScope,
  AdminUser,
  DashboardBootstrapInfo,
  DevicePlatform,
  PublicConsentDetails,
  RustDeskPublicConfig,
  SupportSession,
} from '../types/meridian.ts';

async function requestJson<T>(
  url: string,
  options: RequestInit = {},
  token?: string | null
): Promise<T> {
  const headers = new Headers(options.headers);
  if (!headers.has('Content-Type') && options.body) {
    headers.set('Content-Type', 'application/json');
  }
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const res = await fetch(url, { ...options, headers });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    throw new Error(typeof data.error === 'string' ? data.error : `Request failed (${res.status})`);
  }
  return data as T;
}

export const apiClient = {
  getBootstrap(): Promise<DashboardBootstrapInfo> {
    return requestJson<DashboardBootstrapInfo>('/api/bootstrap');
  },

  registerInitialAdmin(payload: {
    email: string;
    password: string;
    displayName: string;
  }): Promise<{ user: AdminUser; token: string }> {
    return requestJson('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  loginLocal(payload: {
    email: string;
    password: string;
  }): Promise<{ user: AdminUser; token: string }> {
    return requestJson('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  getMe(token: string): Promise<{ user: AdminUser }> {
    return requestJson('/api/auth/me', {}, token);
  },

  listSessions(token: string): Promise<{ sessions: SupportSession[] }> {
    return requestJson('/api/invitations', {}, token);
  },

  createInvitation(
    token: string,
    payload: {
      platform: DevicePlatform;
      recipientLabel: string;
      ttlMinutes: number;
      accessScope: AccessScope;
    }
  ): Promise<{ session: SupportSession }> {
    return requestJson(
      '/api/invitations',
      {
        method: 'POST',
        body: JSON.stringify(payload),
      },
      token
    );
  },

  recordLinkCopied(token: string, sessionId: string): Promise<{ session: SupportSession }> {
    return requestJson(`/api/sessions/${encodeURIComponent(sessionId)}/copied`, { method: 'POST' }, token);
  },

  endSession(token: string, sessionId: string): Promise<{ session: SupportSession }> {
    return requestJson(`/api/sessions/${encodeURIComponent(sessionId)}/end`, { method: 'POST' }, token);
  },

  getRustDeskConfig(token: string): Promise<{ config: RustDeskPublicConfig }> {
    return requestJson('/api/rustdesk/config', {}, token);
  },

  updateRustDeskConfig(
    token: string,
    payload: { hbbsHost: string; hbbrHost: string; publicKey: string }
  ): Promise<{ config: RustDeskPublicConfig }> {
    return requestJson(
      '/api/rustdesk/config',
      {
        method: 'PUT',
        body: JSON.stringify(payload),
      },
      token
    );
  },

  getConsentDetails(inviteToken: string): Promise<PublicConsentDetails> {
    return requestJson(`/api/consent/${encodeURIComponent(inviteToken)}`);
  },

  respondToConsent(
    inviteToken: string,
    payload: { decision: 'allow' | 'reject' | 'end'; rustdeskPeerId?: string }
  ): Promise<PublicConsentDetails> {
    return requestJson(`/api/consent/${encodeURIComponent(inviteToken)}/respond`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },
};
