import { useEffect, useState } from 'react';
import {
  ArrowLeft,
  CheckCircle2,
  Clock,
  ExternalLink,
  Monitor,
  ShieldAlert,
  ShieldCheck,
  Smartphone,
  Square,
  XCircle,
} from 'lucide-react';
import { apiClient } from '../lib/apiClient.ts';
import { RUSTDESK_PLATFORM_GUIDES } from '../services/rustdeskAdapter.ts';
import type { PublicConsentDetails } from '../types/meridian.ts';
import {
  formatCountdown,
  formatPlatformLabel,
  formatScopeLabel,
  formatTimestamp,
} from '../utils/formatting.ts';
import { StatusIndicator } from './StatusIndicator.tsx';

interface ConsentPageViewProps {
  token: string;
  onBackToConsole?: () => void;
  hasAdminSession: boolean;
}

export function ConsentPageView({
  token,
  onBackToConsole,
  hasAdminSession,
}: ConsentPageViewProps) {
  const [details, setDetails] = useState<PublicConsentDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [peerId, setPeerId] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    let active = true;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const res = await apiClient.getConsentDetails(token);
        if (active) setDetails(res);
      } catch (err) {
        if (active) {
          setError(
            err instanceof Error
              ? err.message
              : 'This invitation link is invalid or has expired.'
          );
        }
      } finally {
        if (active) setLoading(false);
      }
    }
    load();
    const poller = setInterval(load, 8000);
    return () => {
      active = false;
      clearInterval(poller);
    };
  }, [token]);

  async function handleDecision(decision: 'allow' | 'reject' | 'end') {
    setSubmitting(true);
    setError(null);
    try {
      const updated = await apiClient.respondToConsent(token, {
        decision,
        rustdeskPeerId: decision === 'allow' ? peerId : undefined,
      });
      setDetails(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to submit your response.');
    } finally {
      setSubmitting(false);
    }
  }

  const guide = details ? RUSTDESK_PLATFORM_GUIDES[details.platform] : null;
  const countdown = details ? formatCountdown(details.expiresAt, nowMs) : '00:00';
  const isExpiredByClock = details ? Date.parse(details.expiresAt) <= nowMs : false;

  return (
    <div className="min-h-screen bg-[#070C17] text-slate-100 flex flex-col justify-between px-4 py-8">
      <header className="max-w-2xl w-full mx-auto flex items-center justify-between gap-4 pb-6 border-b border-slate-800/80">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-blue-600/15 border border-blue-500/30 flex items-center justify-center text-blue-400">
            <ShieldCheck className="w-4 h-4" aria-hidden="true" />
          </div>
          <span className="font-display text-base font-semibold tracking-tight text-white">
            MERIDIAN Remote Access
          </span>
        </div>

        {hasAdminSession && onBackToConsole && (
          <button
            type="button"
            onClick={onBackToConsole}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-400 hover:text-white transition-colors cursor-pointer whitespace-nowrap"
          >
            <ArrowLeft className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Back to Console</span>
          </button>
        )}
      </header>

      <main className="max-w-2xl w-full mx-auto my-8">
        {loading ? (
          <div className="bg-[#0D1526] border border-slate-800 rounded-xl p-8 space-y-4">
            <div className="h-6 w-2/3 bg-slate-800/60 rounded animate-pulse" />
            <div className="h-4 w-full bg-slate-800/40 rounded animate-pulse" />
            <div className="h-24 w-full bg-slate-800/30 rounded animate-pulse" />
          </div>
        ) : error && !details ? (
          <div className="bg-[#0D1526] border border-slate-800 rounded-xl p-8 text-center">
            <ShieldAlert className="w-10 h-10 text-rose-400 mx-auto mb-3" aria-hidden="true" />
            <h1 className="font-display text-xl font-semibold text-white mb-2">
              Invitation unavailable
            </h1>
            <p className="text-sm text-slate-400 max-w-md mx-auto">{error}</p>
          </div>
        ) : details ? (
          <div className="bg-[#0D1526] border border-slate-800 rounded-xl overflow-hidden">
            {/* Top Session Summary Header */}
            <div className="p-6 sm:p-8 border-b border-slate-800">
              <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                <StatusIndicator
                  status={
                    isExpiredByClock && details.status === 'pending_consent'
                      ? 'expired'
                      : details.status
                  }
                />
                {(details.status === 'pending_consent' || details.status === 'approved') && (
                  <div className="inline-flex items-center gap-1.5 font-mono text-xs text-slate-300 tabular-nums">
                    <Clock className="w-3.5 h-3.5 text-blue-400" aria-hidden="true" />
                    <span>Expires in {countdown}</span>
                  </div>
                )}
              </div>

              <h1 className="font-display text-2xl font-semibold text-white mb-2 [text-wrap:balance]">
                Remote support authorization request
              </h1>
              <p className="text-sm text-slate-400 leading-relaxed">
                Administrator <span className="text-slate-200 font-medium">{details.adminEmail}</span>{' '}
                is requesting temporary access to{' '}
                <span className="text-slate-200 font-medium">{details.recipientLabel}</span>.
              </p>

              <dl className="mt-6 grid grid-cols-1 sm:grid-cols-3 gap-4 pt-5 border-t border-slate-800/80 text-xs">
                <div>
                  <dt className="text-slate-500">Target device</dt>
                  <dd className="mt-1 text-slate-200 font-medium inline-flex items-center gap-1.5">
                    {details.platform === 'windows' ? (
                      <Monitor className="w-3.5 h-3.5 text-blue-400" aria-hidden="true" />
                    ) : (
                      <Smartphone className="w-3.5 h-3.5 text-blue-400" aria-hidden="true" />
                    )}
                    <span>{formatPlatformLabel(details.platform)}</span>
                  </dd>
                </div>
                <div>
                  <dt className="text-slate-500">Requested scope</dt>
                  <dd className="mt-1 text-slate-200 font-medium">
                    {formatScopeLabel(details.accessScope)}
                  </dd>
                </div>
                <div>
                  <dt className="text-slate-500">Valid until</dt>
                  <dd className="mt-1 text-slate-200 font-medium tabular-nums">
                    {formatTimestamp(details.expiresAt)}
                  </dd>
                </div>
              </dl>
            </div>

            {/* Interactive Decision Body */}
            <div className="p-6 sm:p-8 space-y-6">
              {error && (
                <div
                  role="alert"
                  className="rounded-lg border border-rose-500/40 bg-rose-950/30 px-4 py-3 text-xs text-rose-200"
                >
                  {error}
                </div>
              )}

              {/* Privacy & Security Promise */}
              <div className="rounded-lg bg-[#070C17] border border-slate-800 p-4 text-xs text-slate-300 leading-relaxed">
                <div className="font-semibold text-white mb-1">
                  Your explicit permission is required
                </div>
                <p className="text-slate-400">
                  MERIDIAN never accesses devices silently and never collects your Windows,
                  Android, or account passwords. You may decline this request or end an authorized
                  session at any moment.
                </p>
              </div>

              {details.status === 'pending_consent' && !isExpiredByClock && (
                <>
                  <div>
                    <label
                      htmlFor="rustdesk-peer-id"
                      className="block text-xs font-medium text-slate-300 mb-1.5"
                    >
                      Optional public RustDesk Device ID (if your client is open)
                    </label>
                    <input
                      id="rustdesk-peer-id"
                      type="text"
                      maxLength={32}
                      value={peerId}
                      onChange={(e) => setPeerId(e.target.value)}
                      placeholder="e.g. 482 910 334 (never enter a password)"
                      className="w-full rounded-lg bg-[#070C17] border border-slate-800 px-3.5 py-2.5 text-sm font-mono text-slate-100 placeholder:text-slate-600 focus:outline-none focus:border-blue-500"
                    />
                  </div>

                  {guide && (
                    <div className="text-xs text-slate-400 space-y-1.5">
                      <div className="font-medium text-slate-300">
                        What happens when you click Allow ({guide.displayName}):
                      </div>
                      <ul className="space-y-1">
                        {guide.permissionRequirements.map((item) => (
                          <li key={item} className="flex items-start gap-2">
                            <span className="text-blue-400 font-mono" aria-hidden="true">
                              -
                            </span>
                            <span>{item}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 pt-2">
                    <button
                      type="button"
                      disabled={submitting}
                      onClick={() => handleDecision('allow')}
                      className="flex-1 min-h-[46px] inline-flex items-center justify-center gap-2 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-60 px-5 py-3 text-sm font-medium text-white transition-colors cursor-pointer whitespace-nowrap"
                    >
                      <CheckCircle2 className="w-4 h-4" aria-hidden="true" />
                      <span>{submitting ? 'Submitting...' : 'Allow Support Access'}</span>
                    </button>

                    <button
                      type="button"
                      disabled={submitting}
                      onClick={() => handleDecision('reject')}
                      className="flex-1 min-h-[46px] inline-flex items-center justify-center gap-2 rounded-lg bg-[#070C17] hover:bg-slate-800 border border-slate-700 disabled:opacity-60 px-5 py-3 text-sm font-medium text-slate-200 transition-colors cursor-pointer whitespace-nowrap"
                    >
                      <XCircle className="w-4 h-4 text-rose-400" aria-hidden="true" />
                      <span>Reject</span>
                    </button>
                  </div>
                </>
              )}

              {details.status === 'approved' && !isExpiredByClock && (
                <div className="space-y-5">
                  <div className="rounded-lg border border-emerald-500/30 bg-emerald-950/20 p-5">
                    <div className="flex items-center gap-2 text-emerald-400 text-sm font-semibold mb-1.5">
                      <CheckCircle2 className="w-4 h-4" aria-hidden="true" />
                      <span>Consent granted</span>
                    </div>
                    <p className="text-xs text-slate-300 leading-relaxed mb-4">
                      {details.handshakeManifest?.notes ??
                        'Your explicit approval has been recorded on the server.'}
                    </p>

                    {details.handshakeManifest && (
                      <div className="rounded-lg bg-[#070C17] border border-slate-800 p-4 space-y-2 text-xs">
                        <div className="flex items-center justify-between gap-4">
                          <span className="text-slate-400">Authorization code</span>
                          <span className="font-mono font-semibold text-blue-400">
                            {details.handshakeManifest.authorizationCode}
                          </span>
                        </div>
                        <div className="flex items-center justify-between gap-4">
                          <span className="text-slate-400">Remote engine state</span>
                          <span className="text-slate-200">
                            {details.handshakeManifest.engineReady
                              ? `Relay ready (${details.handshakeManifest.hbbsHost})`
                              : 'Awaiting RustDesk hbbs/hbbr relay integration'}
                          </span>
                        </div>
                        {details.handshakeManifest.launchUri && (
                          <a
                            href={details.handshakeManifest.launchUri}
                            className="mt-3 w-full min-h-[40px] inline-flex items-center justify-center gap-2 rounded-lg bg-blue-600 hover:bg-blue-500 px-4 py-2 text-xs font-medium text-white transition-colors"
                          >
                            <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
                            <span>Open RustDesk Client</span>
                          </a>
                        )}
                      </div>
                    )}
                  </div>

                  <button
                    type="button"
                    disabled={submitting}
                    onClick={() => handleDecision('end')}
                    className="w-full min-h-[44px] inline-flex items-center justify-center gap-2 rounded-lg border border-rose-500/40 bg-rose-950/30 hover:bg-rose-900/40 px-4 py-2.5 text-sm font-medium text-rose-200 transition-colors cursor-pointer"
                  >
                    <Square className="w-3.5 h-3.5 fill-current" aria-hidden="true" />
                    <span>{submitting ? 'Ending...' : 'End Session Now'}</span>
                  </button>
                </div>
              )}

              {details.status === 'rejected' && (
                <div className="rounded-lg border border-rose-500/30 bg-rose-950/20 p-5 text-xs text-slate-300">
                  <div className="font-semibold text-rose-300 mb-1">Request declined</div>
                  <p className="text-slate-400">
                    You rejected this remote access invitation at{' '}
                    {formatTimestamp(details.respondedAt)}. No remote connection was authorized.
                  </p>
                </div>
              )}

              {(details.status === 'ended' ||
                details.status === 'expired' ||
                (isExpiredByClock && details.status === 'pending_consent')) && (
                <div className="rounded-lg border border-slate-700 bg-[#070C17] p-5 text-xs text-slate-300">
                  <div className="font-semibold text-white mb-1">
                    {details.status === 'ended' ? 'Session ended' : 'Invitation link expired'}
                  </div>
                  <p className="text-slate-400">
                    This support session is closed. Request a fresh temporary link from your
                    administrator if further assistance is needed.
                  </p>
                </div>
              )}
            </div>
          </div>
        ) : null}
      </main>

      <footer className="max-w-2xl w-full mx-auto text-center text-xs text-slate-500 pt-4">
        MERIDIAN Remote Access · Explicit consent required for all remote support sessions
      </footer>
    </div>
  );
}
