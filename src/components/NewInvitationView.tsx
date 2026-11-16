import { useState, type FormEvent } from 'react';
import {
  Check,
  Copy,
  ExternalLink,
  Link2,
  Monitor,
  Share2,
  Shield,
  Smartphone,
} from 'lucide-react';
import { apiClient } from '../lib/apiClient.ts';
import type { AccessScope, DevicePlatform, SupportSession } from '../types/meridian.ts';
import { RUSTDESK_PLATFORM_GUIDES } from '../services/rustdeskAdapter.ts';
import {
  buildConsentUrl,
  formatCountdown,
  formatPlatformLabel,
  formatScopeLabel,
} from '../utils/formatting.ts';

interface NewInvitationViewProps {
  authToken: string;
  nowMs: number;
  onSessionCreated: (session: SupportSession) => void;
  onSessionUpdated: (session: SupportSession) => void;
  onOpenConsentPreview: (token: string) => void;
}

const TTL_OPTIONS = [
  { minutes: 15, label: '15 min' },
  { minutes: 30, label: '30 min' },
  { minutes: 60, label: '1 hour' },
  { minutes: 240, label: '4 hours' },
];

export function NewInvitationView({
  authToken,
  nowMs,
  onSessionCreated,
  onSessionUpdated,
  onOpenConsentPreview,
}: NewInvitationViewProps) {
  const [platform, setPlatform] = useState<DevicePlatform>('windows');
  const [recipientLabel, setRecipientLabel] = useState('');
  const [ttlMinutes, setTtlMinutes] = useState<number>(30);
  const [accessScope, setAccessScope] = useState<AccessScope>('assisted_control');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createdSession, setCreatedSession] = useState<SupportSession | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [shareFeedback, setShareFeedback] = useState<string | null>(null);

  const guide = RUSTDESK_PLATFORM_GUIDES[platform];

  async function handleGenerate(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const { session } = await apiClient.createInvitation(authToken, {
        platform,
        recipientLabel,
        ttlMinutes,
        accessScope,
      });
      setCreatedSession(session);
      onSessionCreated(session);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to generate invitation link.');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCopyLink(session: SupportSession) {
    const url = buildConsentUrl(session.token);
    await navigator.clipboard.writeText(url);
    setCopiedId(session.id);
    setTimeout(() => setCopiedId((prev) => (prev === session.id ? null : prev)), 2500);
    try {
      const { session: updated } = await apiClient.recordLinkCopied(authToken, session.id);
      setCreatedSession(updated);
      onSessionUpdated(updated);
    } catch {
      // Non-fatal if audit event update fails
    }
  }

  async function handleShareLink(session: SupportSession) {
    const url = buildConsentUrl(session.token);
    const shareText = `MERIDIAN Remote Access invitation for ${session.recipientLabel} (${formatPlatformLabel(session.platform)}). Review and approve or decline before ${ttlMinutes} minutes: ${url}`;

    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({
          title: 'MERIDIAN Remote Access Invitation',
          text: shareText,
          url,
        });
        setShareFeedback('Shared via system share sheet.');
        setTimeout(() => setShareFeedback(null), 3000);
        return;
      } catch {
        // User cancelled share or unsupported in iframe; fall back to clipboard message
      }
    }

    await navigator.clipboard.writeText(shareText);
    setShareFeedback('Formatted invitation message copied to clipboard.');
    setTimeout(() => setShareFeedback(null), 3000);
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
      {/* Left Configuration Form */}
      <div className="lg:col-span-7 bg-[#0D1526] border border-slate-800 rounded-xl p-6">
        <div className="mb-6">
          <h2 className="font-display text-lg font-semibold text-white">
            Create temporary support invitation
          </h2>
          <p className="text-sm text-slate-400 mt-1">
            Generate a single-purpose consent link. Remote handoff remains locked until the
            recipient explicitly clicks Allow.
          </p>
        </div>

        {error && (
          <div
            role="alert"
            className="mb-5 rounded-lg border border-rose-500/40 bg-rose-950/30 px-4 py-3 text-xs text-rose-200"
          >
            {error}
          </div>
        )}

        <form onSubmit={handleGenerate} className="space-y-6">
          {/* Device Platform Selection */}
          <div>
            <span className="block text-xs font-medium text-slate-300 mb-2.5">
              Target device platform
            </span>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setPlatform('windows')}
                className={`text-left rounded-lg border p-4 transition-colors cursor-pointer ${
                  platform === 'windows'
                    ? 'bg-blue-600/15 border-blue-500 text-white'
                    : 'bg-[#070C17] border-slate-800 text-slate-300 hover:border-slate-700'
                }`}
              >
                <div className="flex items-center justify-between mb-2">
                  <Monitor className="w-5 h-5 text-blue-400" aria-hidden="true" />
                  <span className="text-xs font-medium text-slate-400">Desktop</span>
                </div>
                <div className="font-medium text-sm text-white">Windows</div>
                <div className="text-xs text-slate-400 mt-0.5">Windows 10 / 11 x64 & ARM64</div>
              </button>

              <button
                type="button"
                onClick={() => setPlatform('android')}
                className={`text-left rounded-lg border p-4 transition-colors cursor-pointer ${
                  platform === 'android'
                    ? 'bg-blue-600/15 border-blue-500 text-white'
                    : 'bg-[#070C17] border-slate-800 text-slate-300 hover:border-slate-700'
                }`}
              >
                <div className="flex items-center justify-between mb-2">
                  <Smartphone className="w-5 h-5 text-blue-400" aria-hidden="true" />
                  <span className="text-xs font-medium text-slate-400">Mobile</span>
                </div>
                <div className="font-medium text-sm text-white">Android</div>
                <div className="text-xs text-slate-400 mt-0.5">Android 10+ Phone & Tablet</div>
              </button>
            </div>
          </div>

          {/* Recipient Reference Label */}
          <div>
            <label
              htmlFor="recipient-label"
              className="block text-xs font-medium text-slate-300 mb-1.5"
            >
              Device or ticket reference
            </label>
            <input
              id="recipient-label"
              type="text"
              maxLength={80}
              value={recipientLabel}
              onChange={(e) => setRecipientLabel(e.target.value)}
              placeholder={
                platform === 'windows'
                  ? 'e.g. Finance Workstation #14 · Ticket INC-4821'
                  : 'e.g. Field Tablet #09 · Ticket INC-4829'
              }
              className="w-full rounded-lg bg-[#070C17] border border-slate-800 px-3.5 py-2.5 text-sm text-slate-100 placeholder:text-slate-600 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
            />
            <p className="text-xs text-slate-500 mt-1.5">
              Descriptive identifier only. Never enter passwords, PINs, or private user credentials.
            </p>
          </div>

          {/* Access Scope */}
          <div>
            <span className="block text-xs font-medium text-slate-300 mb-2">
              Requested support scope
            </span>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 p-1 rounded-lg bg-[#070C17] border border-slate-800">
              <button
                type="button"
                onClick={() => setAccessScope('assisted_control')}
                className={`px-3 py-2 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap ${
                  accessScope === 'assisted_control'
                    ? 'bg-blue-600 text-white'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Assisted remote control
              </button>
              <button
                type="button"
                onClick={() => setAccessScope('view_only')}
                className={`px-3 py-2 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap ${
                  accessScope === 'view_only'
                    ? 'bg-blue-600 text-white'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                View-only diagnostics
              </button>
            </div>
          </div>

          {/* Expiration TTL */}
          <div>
            <span className="block text-xs font-medium text-slate-300 mb-2">
              Link expiration window
            </span>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 p-1 rounded-lg bg-[#070C17] border border-slate-800">
              {TTL_OPTIONS.map((opt) => (
                <button
                  key={opt.minutes}
                  type="button"
                  onClick={() => setTtlMinutes(opt.minutes)}
                  className={`px-3 py-2 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap tabular-nums ${
                    ttlMinutes === opt.minutes
                      ? 'bg-slate-800 text-white border border-slate-700'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <div className="pt-2 flex items-center justify-end">
            <button
              type="submit"
              disabled={submitting}
              className="min-h-[44px] inline-flex items-center gap-2 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-60 px-5 py-2.5 text-sm font-medium text-white transition-colors cursor-pointer whitespace-nowrap shrink-0"
            >
              <Link2 className="w-4 h-4" aria-hidden="true" />
              <span>{submitting ? 'Generating link...' : 'Generate Invitation Link'}</span>
            </button>
          </div>
        </form>
      </div>

      {/* Right Column: Generated Output & Platform Requirements */}
      <div className="lg:col-span-5 space-y-6">
        {createdSession ? (
          <div className="bg-[#0D1526] border border-blue-500/40 rounded-xl p-6">
            <div className="flex items-center justify-between gap-4 mb-3">
              <h3 className="font-display text-base font-semibold text-white">
                Temporary invitation ready
              </h3>
              <span className="font-mono text-xs text-amber-400 tabular-nums whitespace-nowrap">
                Expires in {formatCountdown(createdSession.expiresAt, nowMs)}
              </span>
            </div>

            <div className="text-xs text-slate-400 mb-4 flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="text-slate-200 font-medium">{createdSession.recipientLabel}</span>
              <span aria-hidden="true">·</span>
              <span>{formatPlatformLabel(createdSession.platform)}</span>
              <span aria-hidden="true">·</span>
              <span>{formatScopeLabel(createdSession.accessScope)}</span>
            </div>

            <div className="rounded-lg bg-[#070C17] border border-slate-800 p-3 mb-4">
              <div className="font-mono text-xs text-blue-300 break-all select-all">
                {buildConsentUrl(createdSession.token)}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2.5">
              <button
                type="button"
                onClick={() => handleCopyLink(createdSession)}
                className="min-h-[40px] inline-flex items-center gap-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 px-3.5 py-2 text-xs font-medium text-white transition-colors cursor-pointer whitespace-nowrap"
              >
                {copiedId === createdSession.id ? (
                  <>
                    <Check className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>Copied</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>Copy Link</span>
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={() => handleShareLink(createdSession)}
                className="min-h-[40px] inline-flex items-center gap-1.5 rounded-lg bg-[#070C17] hover:bg-slate-800 border border-slate-700 px-3.5 py-2 text-xs font-medium text-slate-200 transition-colors cursor-pointer whitespace-nowrap"
              >
                <Share2 className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Share</span>
              </button>

              <button
                type="button"
                onClick={() => onOpenConsentPreview(createdSession.token)}
                className="min-h-[40px] inline-flex items-center gap-1.5 rounded-lg bg-[#070C17] hover:bg-slate-800 border border-slate-700 px-3.5 py-2 text-xs font-medium text-slate-200 transition-colors cursor-pointer whitespace-nowrap"
              >
                <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Open Consent Page</span>
              </button>
            </div>

            {shareFeedback && (
              <p className="mt-3 text-xs text-emerald-400">{shareFeedback}</p>
            )}
          </div>
        ) : (
          <div className="bg-[#0D1526] border border-slate-800 rounded-xl p-6">
            <div className="flex items-center gap-2.5 mb-2">
              <Shield className="w-4 h-4 text-blue-400" aria-hidden="true" />
              <h3 className="font-display text-sm font-semibold text-white">
                How consent links work
              </h3>
            </div>
            <p className="text-xs leading-relaxed text-slate-400">
              Each generated URL contains a single-use cryptographic token bound to your
              administrator account and selected device type. The recipient inspects the request and
              chooses Allow or Reject before any engine handoff is prepared.
            </p>
          </div>
        )}

        {/* Selected Platform Requirements */}
        <div className="bg-[#0D1526] border border-slate-800 rounded-xl p-6">
          <h3 className="font-display text-sm font-semibold text-white mb-1">
            {guide.displayName} requirements
          </h3>
          <p className="text-xs text-slate-400 mb-4">
            {guide.minimumVersion} · {guide.clientArtifact}
          </p>
          <ul className="space-y-2.5 border-t border-slate-800 pt-4">
            {guide.permissionRequirements.map((req) => (
              <li key={req} className="text-xs leading-relaxed text-slate-300 flex items-start gap-2">
                <span className="text-blue-400 font-mono mt-0.5" aria-hidden="true">
                  -
                </span>
                <span>{req}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
