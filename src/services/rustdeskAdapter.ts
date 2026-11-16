import type {
  DevicePlatform,
  RustDeskHandshakeManifest,
  RustDeskPublicConfig,
} from '../types/meridian.ts';

export interface RustDeskPlatformGuide {
  platform: DevicePlatform;
  displayName: string;
  minimumVersion: string;
  permissionRequirements: string[];
  clientArtifact: string;
}

export const RUSTDESK_PLATFORM_GUIDES: Record<DevicePlatform, RustDeskPlatformGuide> = {
  windows: {
    platform: 'windows',
    displayName: 'Windows 10 / 11 Desktop',
    minimumVersion: 'Windows 10 (64-bit) or Windows 11',
    clientArtifact: 'RustDesk Portable or MSI Client (x86_64 / ARM64)',
    permissionRequirements: [
      'Explicit consent verified in Meridian before session token issuance',
      'Standard desktop capture permission (elevated UAC prompt only if administrator approves)',
      'Zero persistent background service installed for one-time portable support',
    ],
  },
  android: {
    platform: 'android',
    displayName: 'Android 10+ Mobile & Tablet',
    minimumVersion: 'Android 10 (API 29) or newer',
    clientArtifact: 'RustDesk Android Client (Universal APK / Play Build)',
    permissionRequirements: [
      'Explicit consent verified in Meridian before session token issuance',
      'System MediaProjection screen capture prompt approved by device owner',
      'Optional Android Accessibility toggle for assisted touch input (view-only works without it)',
    ],
  },
};

export function formatPublicKeyFingerprint(publicKey: string): string | null {
  const trimmed = publicKey.trim();
  if (!trimmed) return null;
  if (trimmed.length <= 16) return trimmed;
  return `${trimmed.slice(0, 8)}...${trimmed.slice(-8)}`;
}

export function buildRustDeskLaunchUri(
  config: Pick<RustDeskPublicConfig, 'hbbsHost' | 'publicKey'>,
  authorizationCode: string,
  peerId?: string | null
): string | null {
  if (!config.hbbsHost.trim() || !peerId?.trim()) {
    return null;
  }
  const params = new URLSearchParams();
  params.set('host', config.hbbsHost.trim());
  if (config.publicKey.trim()) {
    params.set('key', config.publicKey.trim());
  }
  params.set('auth', authorizationCode);
  return `rustdesk://connection/new/${encodeURIComponent(peerId.trim())}?${params.toString()}`;
}

export function evaluateRelayReadiness(
  config: RustDeskPublicConfig
): { ready: boolean; label: string; summary: string } {
  const hasHosts = Boolean(config.hbbsHost.trim() && config.hbbrHost.trim());
  const hasKey = Boolean(config.publicKey.trim());

  if (hasHosts && hasKey) {
    return {
      ready: true,
      label: 'Relay Configured',
      summary: `Rendezvous (${config.hbbsHost}) and relay (${config.hbbrHost}) are configured for authorized session handoffs.`,
    };
  }

  return {
    ready: false,
    label: 'Awaiting Relay Setup',
    summary:
      'Consent workflow and authorization tokens are active. Configure your RustDesk hbbs/hbbr relay server and public key to enable live remote desktop streaming.',
  };
}

export function describeHandshakeState(manifest: RustDeskHandshakeManifest | null): string {
  if (!manifest) {
    return 'No engine handshake issued. Recipient consent is required first.';
  }
  if (manifest.engineReady) {
    return `Authorized handoff token ${manifest.authorizationCode} issued for relay ${manifest.hbbsHost}.`;
  }
  return `Consent recorded (${manifest.authorizationCode}). Live remote control remains disabled until a RustDesk hbbs/hbbr relay server is connected.`;
}
