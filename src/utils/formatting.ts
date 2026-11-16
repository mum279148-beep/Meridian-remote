import type { AccessScope, DevicePlatform, SessionStatus } from '../types/meridian.ts';

export function formatCountdown(expiresAtIso: string, nowMs: number): string {
  const diffMs = Date.parse(expiresAtIso) - nowMs;
  if (Number.isNaN(diffMs) || diffMs <= 0) {
    return '00:00';
  }
  const totalSeconds = Math.floor(diffMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const pad = (n: number) => String(n).padStart(2, '0');
  if (hours > 0) {
    return `${hours}h ${pad(minutes)}m ${pad(seconds)}s`;
  }
  return `${pad(minutes)}:${pad(seconds)}`;
}

export function formatTimestamp(iso: string | null): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(date);
}

export function formatPlatformLabel(platform: DevicePlatform): string {
  return platform === 'windows' ? 'Windows' : 'Android';
}

export function formatScopeLabel(scope: AccessScope): string {
  return scope === 'view_only' ? 'View-only diagnostics' : 'Assisted remote control';
}

export function getStatusLabel(status: SessionStatus): string {
  switch (status) {
    case 'pending_consent':
      return 'Pending consent';
    case 'approved':
      return 'Authorized';
    case 'rejected':
      return 'Rejected';
    case 'ended':
      return 'Ended';
    case 'expired':
      return 'Expired';
  }
}

export function buildConsentUrl(token: string): string {
  if (typeof window === 'undefined') {
    return `/consent/${token}`;
  }
  return `${window.location.origin}/consent/${token}`;
}
