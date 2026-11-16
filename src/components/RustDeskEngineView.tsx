import { useEffect, useState, type FormEvent } from 'react';
import { CheckCircle2, Cloud, Database, Save, Server, ShieldAlert } from 'lucide-react';
import { apiClient } from '../lib/apiClient.ts';
import type { DashboardBootstrapInfo, RustDeskPublicConfig } from '../types/meridian.ts';
import {
  evaluateRelayReadiness,
  formatPublicKeyFingerprint,
} from '../services/rustdeskAdapter.ts';

interface RustDeskEngineViewProps {
  authToken: string;
  bootstrap: DashboardBootstrapInfo;
  config: RustDeskPublicConfig | null;
  onConfigUpdated: (config: RustDeskPublicConfig) => void;
}

export function RustDeskEngineView({
  authToken,
  bootstrap,
  config,
  onConfigUpdated,
}: RustDeskEngineViewProps) {
  const [hbbsHost, setHbbsHost] = useState(config?.hbbsHost ?? '');
  const [hbbrHost, setHbbrHost] = useState(config?.hbbrHost ?? '');
  const [publicKey, setPublicKey] = useState(config?.publicKey ?? '');
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (config) {
      setHbbsHost(config.hbbsHost);
      setHbbrHost(config.hbbrHost);
      setPublicKey(config.publicKey);
    }
  }, [config]);

  const readiness = config
    ? evaluateRelayReadiness(config)
    : {
        ready: false,
        label: 'Awaiting Relay Setup',
        summary: 'Configure hbbs/hbbr relay hosts to enable live remote engine handoffs.',
      };

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setFeedback(null);
    setError(null);
    try {
      const { config: updated } = await apiClient.updateRustDeskConfig(authToken, {
        hbbsHost,
        hbbrHost,
        publicKey,
      });
      onConfigUpdated(updated);
      setFeedback('RustDesk relay configuration saved on server.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save RustDesk configuration.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
      {/* Left: RustDesk Relay Config Form */}
      <div className="lg:col-span-7 bg-[#0D1526] border border-slate-800 rounded-xl p-6">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-800 pb-4 mb-5">
          <div>
            <h2 className="font-display text-lg font-semibold text-white">
              RustDesk relay & engine integration
            </h2>
            <p className="text-xs text-slate-400 mt-1">
              Connect a self-hosted RustDesk <code className="font-mono text-slate-300">hbbs</code>{' '}
              ID server and <code className="font-mono text-slate-300">hbbr</code> relay server for
              consent-gated client handoffs.
            </p>
          </div>
          <span
            className={`inline-flex items-center gap-1.5 text-xs font-medium ${
              readiness.ready ? 'text-emerald-400' : 'text-amber-400'
            }`}
          >
            {readiness.ready ? (
              <CheckCircle2 className="w-4 h-4" aria-hidden="true" />
            ) : (
              <ShieldAlert className="w-4 h-4" aria-hidden="true" />
            )}
            <span>{readiness.label}</span>
          </span>
        </div>

        <div className="rounded-lg bg-[#070C17] border border-slate-800 p-4 mb-6 text-xs text-slate-300 leading-relaxed">
          <div className="font-semibold text-white mb-1">Engine capability notice</div>
          <p className="text-slate-400">
            MERIDIAN enforces administrator authentication, temporary link issuance, recipient
            consent verification, and session termination. Live remote desktop video streaming and
            keyboard/mouse input require an active RustDesk{' '}
            <code className="font-mono text-slate-300">hbbs</code>/
            <code className="font-mono text-slate-300">hbbr</code> relay server and native Windows
            or Android RustDesk client. MERIDIAN never simulates fake remote desktop streams.
          </p>
        </div>

        {error && (
          <div
            role="alert"
            className="mb-4 rounded-lg border border-rose-500/40 bg-rose-950/30 px-4 py-3 text-xs text-rose-200"
          >
            {error}
          </div>
        )}
        {feedback && (
          <div className="mb-4 rounded-lg border border-emerald-500/40 bg-emerald-950/30 px-4 py-3 text-xs text-emerald-200">
            {feedback}
          </div>
        )}

        <form onSubmit={handleSave} className="space-y-4">
          <div>
            <label htmlFor="hbbs-host" className="block text-xs font-medium text-slate-300 mb-1.5">
              Rendezvous / ID server host (<code className="font-mono">hbbs</code>)
            </label>
            <input
              id="hbbs-host"
              type="text"
              value={hbbsHost}
              onChange={(e) => setHbbsHost(e.target.value)}
              placeholder="rustdesk.company.com"
              className="w-full rounded-lg bg-[#070C17] border border-slate-800 px-3.5 py-2.5 text-sm font-mono text-slate-100 placeholder:text-slate-600 focus:outline-none focus:border-blue-500"
            />
          </div>

          <div>
            <label htmlFor="hbbr-host" className="block text-xs font-medium text-slate-300 mb-1.5">
              Relay server host (<code className="font-mono">hbbr</code>)
            </label>
            <input
              id="hbbr-host"
              type="text"
              value={hbbrHost}
              onChange={(e) => setHbbrHost(e.target.value)}
              placeholder="relay.company.com"
              className="w-full rounded-lg bg-[#070C17] border border-slate-800 px-3.5 py-2.5 text-sm font-mono text-slate-100 placeholder:text-slate-600 focus:outline-none focus:border-blue-500"
            />
          </div>

          <div>
            <label
              htmlFor="rustdesk-pubkey"
              className="block text-xs font-medium text-slate-300 mb-1.5"
            >
              Server public key (<code className="font-mono">id_ed25519.pub</code>)
            </label>
            <input
              id="rustdesk-pubkey"
              type="text"
              value={publicKey}
              onChange={(e) => setPublicKey(e.target.value)}
              placeholder="Paste public key only — never paste private keys"
              className="w-full rounded-lg bg-[#070C17] border border-slate-800 px-3.5 py-2.5 text-sm font-mono text-slate-100 placeholder:text-slate-600 focus:outline-none focus:border-blue-500"
            />
            {publicKey.trim() && (
              <p className="mt-1.5 text-xs text-slate-500 font-mono">
                Fingerprint: {formatPublicKeyFingerprint(publicKey)}
              </p>
            )}
          </div>

          <div className="pt-2 flex items-center justify-between gap-4">
            <span className="text-xs text-slate-400">
              Server API key env:{' '}
              <span className="text-slate-200 font-medium">
                {config?.hasServerApiKey ? 'Configured in server environment' : 'Not set'}
              </span>
            </span>

            <button
              type="submit"
              disabled={saving}
              className="min-h-[42px] inline-flex items-center gap-2 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-60 px-4 py-2 text-xs font-medium text-white transition-colors cursor-pointer whitespace-nowrap"
            >
              <Save className="w-3.5 h-3.5" aria-hidden="true" />
              <span>{saving ? 'Saving...' : 'Save Relay Settings'}</span>
            </button>
          </div>
        </form>
      </div>

      {/* Right: Supabase & Cloudflare Architecture Checklist */}
      <div className="lg:col-span-5 space-y-6">
        <div className="bg-[#0D1526] border border-slate-800 rounded-xl p-6">
          <div className="flex items-center gap-2.5 mb-3">
            <Database className="w-4 h-4 text-blue-400" aria-hidden="true" />
            <h3 className="font-display text-sm font-semibold text-white">
              Supabase auth & database
            </h3>
          </div>
          <p className="text-xs text-slate-400 leading-relaxed mb-4">
            Current mode:{' '}
            <span className="text-slate-200 font-medium">
              {bootstrap.supabaseConfigured
                ? 'Connected to Supabase Auth & PostgreSQL'
                : 'Standalone local server store (ready for Supabase migration)'}
            </span>
          </p>
          <ul className="space-y-2 text-xs text-slate-300 border-t border-slate-800 pt-3">
            <li>
              SQL schema & RLS policies included in{' '}
              <code className="font-mono text-blue-300">supabase/schema.sql</code>
            </li>
            <li>
              Client uses <code className="font-mono text-slate-200">VITE_SUPABASE_URL</code> and{' '}
              <code className="font-mono text-slate-200">VITE_SUPABASE_ANON_KEY</code>
            </li>
            <li>
              Server verifies JWTs using{' '}
              <code className="font-mono text-slate-200">SUPABASE_SERVICE_ROLE_KEY</code> without
              exposing secrets to browsers
            </li>
          </ul>
        </div>

        <div className="bg-[#0D1526] border border-slate-800 rounded-xl p-6">
          <div className="flex items-center gap-2.5 mb-3">
            <Cloud className="w-4 h-4 text-blue-400" aria-hidden="true" />
            <h3 className="font-display text-sm font-semibold text-white">
              Cloudflare Pages compatibility
            </h3>
          </div>
          <ul className="space-y-2 text-xs text-slate-300">
            <li>
              Static Vite output builds cleanly to{' '}
              <code className="font-mono text-blue-300">dist/</code> via{' '}
              <code className="font-mono text-slate-200">npm run build</code>
            </li>
            <li>
              Web-standard API router provided at{' '}
              <code className="font-mono text-blue-300">functions/api/[[path]].ts</code>
            </li>
            <li>
              Cloudflare configuration included in{' '}
              <code className="font-mono text-blue-300">wrangler.toml</code> and{' '}
              <code className="font-mono text-blue-300">public/_redirects</code>
            </li>
          </ul>
        </div>

        <div className="bg-[#0D1526] border border-slate-800 rounded-xl p-6">
          <div className="flex items-center gap-2.5 mb-3">
            <Server className="w-4 h-4 text-blue-400" aria-hidden="true" />
            <h3 className="font-display text-sm font-semibold text-white">
              Consent-to-engine authorization flow
            </h3>
          </div>
          <ol className="space-y-2 text-xs text-slate-400 leading-relaxed">
            <li>1. Admin generates a cryptographically signed temporary token.</li>
            <li>2. Recipient opens the consent URL and reviews platform + scope.</li>
            <li>3. Only after clicking Allow does the server issue an authorization code.</li>
            <li>4. Either party can click End Session at any time to revoke the token.</li>
          </ol>
        </div>
      </div>
    </div>
  );
}
