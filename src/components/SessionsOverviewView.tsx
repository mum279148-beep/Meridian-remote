import { useState } from 'react';
import {
  Check,
  Copy,
  ExternalLink,
  Monitor,
  Plus,
  Share2,
  Smartphone,
  Square,
} from 'lucide-react';
import { apiClient } from '../lib/apiClient.ts';
import type { RustDeskPublicConfig, SupportSession } from '../types/meridian.ts';
import { evaluateRelayReadiness } from '../services/rustdeskAdapter.ts';
import {
  buildConsentUrl,
  formatCountdown,
  formatPlatformLabel,
  formatScopeLabel,
  formatTimestamp,
} from '../utils/formatting.ts';
import { StatusIndicator } from './StatusIndicator.tsx';

interface SessionsOverviewViewProps {
  authToken: string;
  sessions: SupportSession[];
  rustdeskConfig: RustDeskPublicConfig | null;
  loading: boolean;
  nowMs: number;
  onCreateNewClick: () => void;
  onSessionUpdated: (session: SupportSession) => void;
  onOpenConsentPreview: (token: string) => void;
}

export function SessionsOverviewView({
  authToken,
  sessions,
  rustdeskConfig,
  loading,
  nowMs,
  onCreateNewClick,
  onSessionUpdated,
  onOpenConsentPreview,
}: SessionsOverviewViewProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [endingId, setEndingId] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  const activeOrPending = sessions.filter(
    (s) => s.status === 'pending_consent' || s.status === 'approved'
  );
  const pendingCount = sessions.filter((s) => s.status === 'pending_consent').length;
  const approvedCount = sessions.filter((s) => s.status === 'approved').length;

  const relayStatus = rustdeskConfig
    ? evaluateRelayReadiness(rustdeskConfig)
    : { ready: false, label: 'Checking...', summary: '' };

  const selectedSession =
    sessions.find((s) => s.id === selectedId) ?? activeOrPending[0] ?? sessions[0] ?? null;

  async function handleCopy(session: SupportSession) {
    await navigator.clipboard.writeText(buildConsentUrl(session.token));
    setCopiedId(session.id);
    setTimeout(() => setCopiedId((prev) => (prev === session.id ? null : prev)), 2200);
    try {
      const { session: updated } = await apiClient.recordLinkCopied(authToken, session.id);
      onSessionUpdated(updated);
    } catch {
      // Ignore non-fatal audit sync error
    }
  }

  async function handleShare(session: SupportSession) {
    const url = buildConsentUrl(session.token);
    const text = `MERIDIAN Remote Access invitation for ${session.recipientLabel} (${formatPlatformLabel(session.platform)}): ${url}`;
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({
          title: 'MERIDIAN Remote Access Invitation',
          text,
          url,
        });
        return;
      } catch {
        // Fallback to clipboard
      }
    }
    await navigator.clipboard.writeText(text);
    setActionMessage('Invitation message copied for sharing.');
    setTimeout(() => setActionMessage(null), 2600);
  }

  async function handleEndSession(session: SupportSession) {
    setEndingId(session.id);
    try {
      const { session: updated } = await apiClient.endSession(authToken, session.id);
      onSessionUpdated(updated);
      setActionMessage(`Session "${updated.recipientLabel}" ended.`);
      setTimeout(() => setActionMessage(null), 3000);
    } catch (err) {
      setActionMessage(err instanceof Error ? err.message : 'Unable to end session.');
    } finally {
      setEndingId(null);
    }
  }

  return (
    <div className="space-y-6">
      {/* 4-column flat KPI strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 bg-[#0D1526] border border-slate-800 rounded-xl divide-y lg:divide-y-0 lg:divide-x divide-slate-800">
        <div className="p-5">
          <div className="text-xs font-medium text-slate-400">Pending consent</div>
          <div className="mt-2 font-display text-2xl font-semibold text-white tabular-nums">
            {pendingCount}
          </div>
          <div className="mt-1 text-xs text-slate-500">Awaiting recipient Allow/Reject</div>
        </div>
        <div className="p-5">
          <div className="text-xs font-medium text-slate-400">Authorized sessions</div>
          <div className="mt-2 font-display text-2xl font-semibold text-emerald-400 tabular-nums">
            {approvedCount}
          </div>
          <div className="mt-1 text-xs text-slate-500">Explicitly approved by user</div>
        </div>
        <div className="p-5">
          <div className="text-xs font-medium text-slate-400">Total invitations</div>
          <div className="mt-2 font-display text-2xl font-semibold text-white tabular-nums">
            {sessions.length}
          </div>
          <div className="mt-1 text-xs text-slate-500">Recorded in audit ledger</div>
        </div>
        <div className="p-5">
          <div className="text-xs font-medium text-slate-400">RustDesk relay</div>
          <div
            className={`mt-2 font-display text-lg font-semibold ${
              relayStatus.ready ? 'text-blue-400' : 'text-amber-400'
            }`}
          >
            {relayStatus.label}
          </div>
          <div className="mt-1 text-xs text-slate-500 truncate">
            {rustdeskConfig?.hbbsHost ? rustdeskConfig.hbbsHost : 'Configure hbbs/hbbr host'}
          </div>
        </div>
      </div>

      {actionMessage && (
        <div className="rounded-lg border border-blue-500/30 bg-blue-950/30 px-4 py-2.5 text-xs text-blue-200">
          {actionMessage}
        </div>
      )}

      {/* Main Split: Active/Pending Queue + Inspector */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
        <div className="xl:col-span-7 bg-[#0D1526] border border-slate-800 rounded-xl overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between gap-4">
            <div>
              <h2 className="font-display text-base font-semibold text-white">
                Active & pending invitations
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Monitor expiration timers, share invitation links, or terminate access immediately.
              </p>
            </div>
            <button
              type="button"
              onClick={onCreateNewClick}
              className="min-h-[38px] inline-flex items-center gap-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 px-3.5 py-1.5 text-xs font-medium text-white transition-colors cursor-pointer whitespace-nowrap shrink-0"
            >
              <Plus className="w-3.5 h-3.5" aria-hidden="true" />
              <span>New Invitation</span>
            </button>
          </div>

          {loading ? (
            <div className="p-6 space-y-3">
              <div className="h-16 rounded-lg bg-slate-800/40 animate-pulse" />
              <div className="h-16 rounded-lg bg-slate-800/40 animate-pulse" />
            </div>
          ) : activeOrPending.length === 0 ? (
            <div className="p-10 text-center">
              <p className="text-sm font-medium text-slate-200">
                No active or pending support sessions
              </p>
              <p className="text-xs text-slate-400 mt-1 mb-5 max-w-md mx-auto">
                Create a temporary invitation link for a Windows or Android device. Once shared,
                the recipient can approve or decline access.
              </p>
              <button
                type="button"
                onClick={onCreateNewClick}
                className="min-h-[40px] inline-flex items-center gap-2 rounded-lg bg-blue-600 hover:bg-blue-500 px-4 py-2 text-xs font-medium text-white transition-colors cursor-pointer whitespace-nowrap"
              >
                <Plus className="w-4 h-4" aria-hidden="true" />
                <span>Create First Invitation</span>
              </button>
            </div>
          ) : (
            <div className="divide-y divide-slate-800/80">
              {activeOrPending.map((session) => {
                const isSelected = selectedSession?.id === session.id;
                const countdown = formatCountdown(session.expiresAt, nowMs);
                return (
                  <div
                    key={session.id}
                    onClick={() => setSelectedId(session.id)}
                    className={`p-5 transition-colors cursor-pointer ${
                      isSelected ? 'bg-blue-950/20' : 'hover:bg-slate-900/50'
                    }`}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2.5">
                          {session.platform === 'windows' ? (
                            <Monitor className="w-4 h-4 text-blue-400 shrink-0" aria-hidden="true" />
                          ) : (
                            <Smartphone
                              className="w-4 h-4 text-blue-400 shrink-0"
                              aria-hidden="true"
                            />
                          )}
                          <span className="font-medium text-sm text-white truncate">
                            {session.recipientLabel}
                          </span>
                        </div>
                        <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-400">
                          <StatusIndicator status={session.status} />
                          <span aria-hidden="true">·</span>
                          <span>{formatPlatformLabel(session.platform)}</span>
                          <span aria-hidden="true">·</span>
                          <span>{formatScopeLabel(session.accessScope)}</span>
                        </div>
                      </div>

                      <div className="text-right shrink-0">
                        <div className="text-xs text-slate-400">Expires in</div>
                        <div className="font-mono text-sm font-medium text-slate-100 tabular-nums">
                          {countdown}
                        </div>
                      </div>
                    </div>

                    <div
                      className="mt-4 flex flex-wrap items-center gap-2"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <button
                        type="button"
                        onClick={() => handleCopy(session)}
                        className="min-h-[36px] inline-flex items-center gap-1.5 rounded-md bg-[#070C17] hover:bg-slate-800 border border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-200 transition-colors cursor-pointer whitespace-nowrap"
                      >
                        {copiedId === session.id ? (
                          <>
                            <Check className="w-3.5 h-3.5 text-emerald-400" aria-hidden="true" />
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
                        onClick={() => handleShare(session)}
                        className="min-h-[36px] inline-flex items-center gap-1.5 rounded-md bg-[#070C17] hover:bg-slate-800 border border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-200 transition-colors cursor-pointer whitespace-nowrap"
                      >
                        <Share2 className="w-3.5 h-3.5" aria-hidden="true" />
                        <span>Share</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => onOpenConsentPreview(session.token)}
                        className="min-h-[36px] inline-flex items-center gap-1.5 rounded-md bg-[#070C17] hover:bg-slate-800 border border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-200 transition-colors cursor-pointer whitespace-nowrap"
                      >
                        <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
                        <span>Consent Page</span>
                      </button>

                      <button
                        type="button"
                        disabled={endingId === session.id}
                        onClick={() => handleEndSession(session)}
                        className="min-h-[36px] ml-auto inline-flex items-center gap-1.5 rounded-md bg-rose-950/40 hover:bg-rose-900/50 border border-rose-500/40 px-3 py-1.5 text-xs font-medium text-rose-200 transition-colors cursor-pointer whitespace-nowrap disabled:opacity-50"
                      >
                        <Square className="w-3 h-3 fill-current" aria-hidden="true" />
                        <span>{endingId === session.id ? 'Ending...' : 'End Session'}</span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Right Session Detail & Audit Trail Inspector */}
        <div className="xl:col-span-5 bg-[#0D1526] border border-slate-800 rounded-xl p-6">
          {selectedSession ? (
            <div className="space-y-5">
              <div className="flex items-start justify-between gap-4 border-b border-slate-800 pb-4">
                <div>
                  <h3 className="font-display text-base font-semibold text-white">
                    {selectedSession.recipientLabel}
                  </h3>
                  <div className="mt-1 flex items-center gap-2 text-xs text-slate-400">
                    <StatusIndicator status={selectedSession.status} />
                    <span aria-hidden="true">·</span>
                    <span>{formatPlatformLabel(selectedSession.platform)}</span>
                  </div>
                </div>
                <span className="font-mono text-xs text-slate-500">
                  {selectedSession.id.slice(0, 8)}
                </span>
              </div>

              <dl className="grid grid-cols-2 gap-4 text-xs">
                <div>
                  <dt className="text-slate-500">Created</dt>
                  <dd className="text-slate-200 mt-0.5 tabular-nums">
                    {formatTimestamp(selectedSession.createdAt)}
                  </dd>
                </div>
                <div>
                  <dt className="text-slate-500">Expires</dt>
                  <dd className="text-slate-200 mt-0.5 tabular-nums">
                    {formatTimestamp(selectedSession.expiresAt)}
                  </dd>
                </div>
                <div>
                  <dt className="text-slate-500">Access scope</dt>
                  <dd className="text-slate-200 mt-0.5">
                    {formatScopeLabel(selectedSession.accessScope)}
                  </dd>
                </div>
                <div>
                  <dt className="text-slate-500">RustDesk Peer ID</dt>
                  <dd className="font-mono text-slate-200 mt-0.5">
                    {selectedSession.rustdeskPeerId || 'Not bound'}
                  </dd>
                </div>
              </dl>

              {/* Engine Handoff Notice */}
              <div className="rounded-lg bg-[#070C17] border border-slate-800 p-4">
                <div className="text-xs font-semibold text-slate-200 mb-1">
                  Remote engine handoff state
                </div>
                {selectedSession.handshakeManifest ? (
                  <div className="space-y-2 text-xs text-slate-300">
                    <p className="text-slate-400 leading-relaxed">
                      {selectedSession.handshakeManifest.notes}
                    </p>
                    <div className="flex items-center justify-between pt-2 border-t border-slate-800/80">
                      <span className="text-slate-500">Authorization code</span>
                      <span className="font-mono text-blue-400 font-medium">
                        {selectedSession.handshakeManifest.authorizationCode}
                      </span>
                    </div>
                    {selectedSession.handshakeManifest.launchUri && (
                      <a
                        href={selectedSession.handshakeManifest.launchUri}
                        className="mt-2 w-full min-h-[36px] inline-flex items-center justify-center gap-2 rounded-md bg-blue-600 hover:bg-blue-500 px-3 py-2 text-xs font-medium text-white transition-colors"
                      >
                        <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
                        <span>Launch Authorized RustDesk Client</span>
                      </a>
                    )}
                  </div>
                ) : (
                  <p className="text-xs text-slate-400 leading-relaxed">
                    Remote desktop streaming is disabled until the recipient explicitly approves
                    the invitation link.
                  </p>
                )}
              </div>

              {/* Audit Trail */}
              <div>
                <h4 className="text-xs font-semibold text-slate-300 mb-3">Session audit trail</h4>
                <ol className="space-y-3 border-t border-slate-800 pt-3">
                  {selectedSession.events.map((ev) => (
                    <li key={ev.id} className="text-xs">
                      <div className="flex items-center justify-between gap-2 text-slate-200">
                        <span className="font-medium">{ev.summary}</span>
                      </div>
                      <div className="mt-0.5 text-slate-500 tabular-nums">
                        {formatTimestamp(ev.createdAt)} · {ev.actor}
                      </div>
                    </li>
                  ))}
                </ol>
              </div>
            </div>
          ) : (
            <div className="py-8 text-center text-xs text-slate-500">
              Select a session to inspect its authorization state and audit events.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
