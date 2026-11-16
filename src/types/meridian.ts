export type DevicePlatform = 'windows' | 'android';

export type SessionStatus =
  | 'pending_consent'
  | 'approved'
  | 'rejected'
  | 'ended'
  | 'expired';

export type AccessScope = 'view_only' | 'assisted_control';

export type AuthProviderMode = 'supabase' | 'server_local';

export interface AdminUser {
  id: string;
  email: string;
  displayName: string;
  role: 'admin';
  authProvider: AuthProviderMode;
}

export interface SessionEvent {
  id: string;
  sessionId: string;
  eventType:
    | 'invitation_created'
    | 'link_copied'
    | 'consent_viewed'
    | 'consent_allowed'
    | 'consent_rejected'
    | 'session_ended'
    | 'session_expired'
    | 'rustdesk_handshake_prepared';
  actor: string;
  summary: string;
  createdAt: string;
}

export interface RustDeskHandshakeManifest {
  engineReady: boolean;
  engineState: 'awaiting_relay_config' | 'authorized_for_handoff';
  hbbsHost: string | null;
  hbbrHost: string | null;
  publicKeyFingerprint: string | null;
  authorizationCode: string;
  targetPlatform: DevicePlatform;
  launchUri: string | null;
  notes: string;
}

export interface SupportSession {
  id: string;
  token: string;
  adminId: string;
  adminEmail: string;
  recipientLabel: string;
  platform: DevicePlatform;
  accessScope: AccessScope;
  status: SessionStatus;
  ttlMinutes: number;
  createdAt: string;
  expiresAt: string;
  respondedAt: string | null;
  endedAt: string | null;
  endedBy: string | null;
  consentNote: string | null;
  rustdeskPeerId: string | null;
  handshakeManifest: RustDeskHandshakeManifest | null;
  events: SessionEvent[];
}

export interface PublicConsentDetails {
  sessionId: string;
  organizationName: string;
  adminEmail: string;
  recipientLabel: string;
  platform: DevicePlatform;
  accessScope: AccessScope;
  status: SessionStatus;
  createdAt: string;
  expiresAt: string;
  respondedAt: string | null;
  endedAt: string | null;
  handshakeManifest: RustDeskHandshakeManifest | null;
}

export interface RustDeskPublicConfig {
  configured: boolean;
  hbbsHost: string;
  hbbrHost: string;
  publicKey: string;
  hasServerApiKey: boolean;
  deploymentTarget: 'cloudflare_pages' | 'node_express';
  updatedAt: string | null;
}

export interface DashboardBootstrapInfo {
  authMode: AuthProviderMode;
  supabaseConfigured: boolean;
  requiresInitialAdminSetup: boolean;
  deploymentRuntime: string;
}
