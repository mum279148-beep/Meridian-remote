import { useMemo, useState } from 'react';
import { Monitor, Search, Smartphone, Square } from 'lucide-react';
import { apiClient } from '../lib/apiClient.ts';
import type { DevicePlatform, SessionStatus, SupportSession } from '../types/meridian.ts';
import {
  formatCountdown,
  formatPlatformLabel,
  formatScopeLabel,
  formatTimestamp,
} from '../utils/formatting.ts';
import { StatusIndicator } from './StatusIndicator.tsx';

interface SessionHistoryViewProps {
  authToken: string;
  sessions: SupportSession[];
  loading: boolean;
  nowMs: number;
  onSessionUpdated: (session: SupportSession) => void;
}

type StatusFilter = 'all' | SessionStatus;
type PlatformFilter = 'all' | DevicePlatform;

export function SessionHistoryView({
  authToken,
  sessions,
  loading,
  nowMs,
  onSessionUpdated,
}: SessionHistoryViewProps) {
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [platformFilter, setPlatformFilter] = useState<PlatformFilter>('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [endingId, setEndingId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return sessions.filter((s) => {
      if (statusFilter !== 'all' && s.status !== statusFilter) return false;
      if (platformFilter !== 'all' && s.platform !== platformFilter) return false;
      if (!q) return true;
      return (
        s.recipientLabel.toLowerCase().includes(q) ||
        s.id.toLowerCase().includes(q) ||
        s.adminEmail.toLowerCase().includes(q)
      );
    });
  }, [sessions, query, statusFilter, platformFilter]);

  const selectedSession = filtered.find((s) => s.id === selectedId) ?? null;

  async function handleEnd(session: SupportSession) {
    setEndingId(session.id);
    try {
      const { session: updated } = await apiClient.endSession(authToken, session.id);
      onSessionUpdated(updated);
    } finally {
      setEndingId(null);
    }
  }

  return (
    <div className="space-y-5">
      {/* Search and Segmented Filters */}
      <div className="bg-[#0D1526] border border-slate-800 rounded-xl p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="relative flex-1 max-w-md">
          <Search
            className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none"
            aria-hidden="true"
          />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by device label, session ID, or admin email"
            className="w-full rounded-lg bg-[#070C17] border border-slate-800 pl-10 pr-3.5 py-2 text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-blue-500"
          />
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1 p-1 rounded-lg bg-[#070C17] border border-slate-800">
            {(['all', 'approved', 'pending_consent', 'ended', 'rejected', 'expired'] as StatusFilter[]).map(
              (st) => (
                <button
                  key={st}
                  type="button"
                  onClick={() => setStatusFilter(st)}
                  className={`px-2.5 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap ${
                    statusFilter === st
                      ? 'bg-blue-600 text-white'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {st === 'all'
                    ? 'All'
                    : st === 'pending_consent'
                      ? 'Pending'
                      : st === 'approved'
                        ? 'Authorized'
                        : st.charAt(0).toUpperCase() + st.slice(1)}
                </button>
              )
            )}
          </div>

          <div className="flex items-center gap-1 p-1 rounded-lg bg-[#070C17] border border-slate-800">
            {(['all', 'windows', 'android'] as PlatformFilter[]).map((pf) => (
              <button
                key={pf}
                type="button"
                onClick={() => setPlatformFilter(pf)}
                className={`px-2.5 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap ${
                  platformFilter === pf
                    ? 'bg-slate-800 text-white'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {pf === 'all' ? 'All OS' : pf === 'windows' ? 'Windows' : 'Android'}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* High-Density Data Table */}
      <div className="bg-[#0D1526] border border-slate-800 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-800 text-xs font-medium text-slate-400 bg-[#0B1221]">
                <th className="py-3 px-4">Target Device</th>
                <th className="py-3 px-4">Platform</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4">Scope</th>
                <th className="py-3 px-4">Created</th>
                <th className="py-3 px-4">Expiration</th>
                <th className="py-3 px-4 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/70 text-xs">
              {loading ? (
                <tr>
                  <td colSpan={7} className="py-10 text-center text-slate-400">
                    Loading session history...
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-slate-400">
                    No sessions match the current search or status filters.
                  </td>
                </tr>
              ) : (
                filtered.map((session) => {
                  const isActive =
                    session.status === 'pending_consent' || session.status === 'approved';
                  return (
                    <tr
                      key={session.id}
                      onClick={() =>
                        setSelectedId((prev) => (prev === session.id ? null : session.id))
                      }
                      className={`h-[44px] transition-colors cursor-pointer ${
                        selectedId === session.id ? 'bg-blue-950/20' : 'hover:bg-slate-900/40'
                      }`}
                    >
                      <td className="py-2.5 px-4 font-medium text-slate-100">
                        <div>{session.recipientLabel}</div>
                        <div className="font-mono text-[11px] text-slate-500">
                          {session.id.slice(0, 8)}
                        </div>
                      </td>
                      <td className="py-2.5 px-4 text-slate-300 whitespace-nowrap">
                        <span className="inline-flex items-center gap-1.5">
                          {session.platform === 'windows' ? (
                            <Monitor className="w-3.5 h-3.5 text-slate-400" aria-hidden="true" />
                          ) : (
                            <Smartphone className="w-3.5 h-3.5 text-slate-400" aria-hidden="true" />
                          )}
                          <span>{formatPlatformLabel(session.platform)}</span>
                        </span>
                      </td>
                      <td className="py-2.5 px-4">
                        <StatusIndicator status={session.status} />
                      </td>
                      <td className="py-2.5 px-4 text-slate-300 whitespace-nowrap">
                        {formatScopeLabel(session.accessScope)}
                      </td>
                      <td className="py-2.5 px-4 text-slate-400 tabular-nums whitespace-nowrap">
                        {formatTimestamp(session.createdAt)}
                      </td>
                      <td className="py-2.5 px-4 font-mono text-slate-300 tabular-nums whitespace-nowrap">
                        {isActive
                          ? formatCountdown(session.expiresAt, nowMs)
                          : formatTimestamp(session.endedAt ?? session.expiresAt)}
                      </td>
                      <td
                        className="py-2.5 px-4 text-right whitespace-nowrap"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {isActive ? (
                          <button
                            type="button"
                            disabled={endingId === session.id}
                            onClick={() => handleEnd(session)}
                            className="inline-flex items-center gap-1 rounded-md border border-rose-500/40 bg-rose-950/30 hover:bg-rose-900/40 px-2.5 py-1 text-xs font-medium text-rose-200 transition-colors cursor-pointer"
                          >
                            <Square className="w-2.5 h-2.5 fill-current" aria-hidden="true" />
                            <span>{endingId === session.id ? 'Ending...' : 'End'}</span>
                          </button>
                        ) : (
                          <span className="text-slate-500">Closed</span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Expanded Audit Trail Panel for Selected Row */}
      {selectedSession && (
        <div className="bg-[#0D1526] border border-slate-800 rounded-xl p-6">
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800 pb-4 mb-4">
            <div>
              <h3 className="font-display text-sm font-semibold text-white">
                Audit log · {selectedSession.recipientLabel}
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                Initiated by {selectedSession.adminEmail}
                {selectedSession.endedBy ? ` · Closed by ${selectedSession.endedBy}` : ''}
              </p>
            </div>
            <StatusIndicator status={selectedSession.status} />
          </div>

          <ol className="space-y-2.5">
            {selectedSession.events.map((ev) => (
              <li
                key={ev.id}
                className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 text-xs py-1.5 border-b border-slate-800/50 last:border-b-0"
              >
                <span className="text-slate-200">{ev.summary}</span>
                <span className="font-mono text-slate-500 tabular-nums shrink-0">
                  {formatTimestamp(ev.createdAt)} · {ev.actor}
                </span>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}
