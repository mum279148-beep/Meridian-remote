import { useState, type FormEvent } from 'react';
import { ArrowRight, KeyRound, Lock, ShieldCheck } from 'lucide-react';
import { apiClient } from '../lib/apiClient.ts';
import { getSupabaseClient } from '../lib/supabase.ts';
import type { AdminUser, DashboardBootstrapInfo } from '../types/meridian.ts';

interface AdminLoginViewProps {
  bootstrap: DashboardBootstrapInfo;
  onAuthenticated: (user: AdminUser, token: string) => void;
}

export function AdminLoginView({ bootstrap, onAuthenticated }: AdminLoginViewProps) {
  const isSetupMode = bootstrap.authMode === 'server_local' && bootstrap.requiresInitialAdminSetup;
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      if (bootstrap.authMode === 'supabase') {
        const supabase = getSupabaseClient();
        if (!supabase) {
          throw new Error(
            'Supabase URL or anon key is missing in client environment configuration.'
          );
        }
        const { data, error: signInErr } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });
        if (signInErr || !data.session || !data.user?.email) {
          throw new Error(signInErr?.message || 'Unable to sign in with Supabase Auth.');
        }
        const admin: AdminUser = {
          id: data.user.id,
          email: data.user.email,
          displayName:
            typeof data.user.user_metadata?.display_name === 'string'
              ? data.user.user_metadata.display_name
              : data.user.email.split('@')[0],
          role: 'admin',
          authProvider: 'supabase',
        };
        onAuthenticated(admin, data.session.access_token);
        return;
      }

      if (isSetupMode) {
        const res = await apiClient.registerInitialAdmin({
          email,
          password,
          displayName,
        });
        onAuthenticated(res.user, res.token);
      } else {
        const res = await apiClient.loginLocal({ email, password });
        onAuthenticated(res.user, res.token);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Authentication failed.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#070C17] text-slate-100 flex flex-col justify-center px-4 py-12">
      <div className="w-full max-w-4xl mx-auto grid grid-cols-1 lg:grid-cols-12 gap-8 items-stretch">
        {/* Left Brand & Security Architecture Column */}
        <div className="lg:col-span-6 flex flex-col justify-between bg-[#0B1221] border border-slate-800/80 rounded-xl p-8">
          <div>
            <div className="flex items-center gap-3 mb-8">
              <div className="w-9 h-9 rounded-lg bg-blue-600/15 border border-blue-500/30 flex items-center justify-center text-blue-400">
                <ShieldCheck className="w-5 h-5" aria-hidden="true" />
              </div>
              <span className="font-display text-lg font-semibold tracking-tight text-slate-100">
                MERIDIAN Remote Access
              </span>
            </div>

            <h1 className="font-display text-2xl sm:text-3xl font-semibold tracking-tight text-white mb-4 [text-wrap:balance]">
              Consent-verified remote support administration
            </h1>
            <p className="text-sm leading-relaxed text-slate-400 mb-8">
              Issue temporary support links for Windows and Android endpoints, verify explicit
              recipient approval before any session opens, and maintain a complete audit ledger.
            </p>

            <div className="space-y-4 border-t border-slate-800/80 pt-6">
              <div>
                <h2 className="text-xs font-semibold text-slate-200 mb-1">
                  Explicit recipient authorization
                </h2>
                <p className="text-xs leading-relaxed text-slate-400">
                  Every remote connection requires a recipient to click Allow on a dedicated
                  consent page before any engine handoff token is issued.
                </p>
              </div>
              <div>
                <h2 className="text-xs font-semibold text-slate-200 mb-1">
                  Zero credential harvesting
                </h2>
                <p className="text-xs leading-relaxed text-slate-400">
                  Recipients are never prompted for system passwords, PINs, or private credentials.
                </p>
              </div>
              <div>
                <h2 className="text-xs font-semibold text-slate-200 mb-1">
                  Server-enforced expiration
                </h2>
                <p className="text-xs leading-relaxed text-slate-400">
                  Invitation links automatically expire and terminate on the server after their
                  configured time-to-live.
                </p>
              </div>
            </div>
          </div>

          <div className="mt-8 pt-5 border-t border-slate-800/80 flex items-center justify-between text-xs text-slate-500">
            <span>
              Auth Provider:{' '}
              <span className="text-slate-300 font-medium">
                {bootstrap.authMode === 'supabase' ? 'Supabase Auth' : 'Standalone Server Auth'}
              </span>
            </span>
            <span>
              Runtime:{' '}
              <span className="text-slate-300 font-medium">
                {bootstrap.deploymentRuntime === 'cloudflare_workers'
                  ? 'Cloudflare Workers'
                  : bootstrap.deploymentRuntime === 'cloudflare_pages'
                    ? 'Cloudflare Pages'
                    : 'Node Express'}
              </span>
            </span>
          </div>
        </div>

        {/* Right Sign-In Form Column */}
        <div className="lg:col-span-6 bg-[#0D1526] border border-slate-800 rounded-xl p-8 flex flex-col justify-center">
          <div className="mb-6">
            <h2 className="font-display text-xl font-semibold text-white mb-1.5">
              {isSetupMode ? 'Initialize administrator account' : 'Administrator sign in'}
            </h2>
            <p className="text-sm text-slate-400">
              {isSetupMode
                ? 'No administrator exists in the local store yet. Set your email and password to secure this workspace.'
                : 'Sign in with your authorized administrator email and password.'}
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

          <form onSubmit={handleSubmit} className="space-y-4">
            {isSetupMode && (
              <div>
                <label htmlFor="admin-name" className="block text-xs font-medium text-slate-300 mb-1.5">
                  Administrator name
                </label>
                <input
                  id="admin-name"
                  type="text"
                  required
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="Alex Mercer"
                  className="w-full rounded-lg bg-[#070C17] border border-slate-800 px-3.5 py-2.5 text-sm text-slate-100 placeholder:text-slate-600 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                />
              </div>
            )}

            <div>
              <label htmlFor="admin-email" className="block text-xs font-medium text-slate-300 mb-1.5">
                Email address
              </label>
              <input
                id="admin-email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="admin@company.com"
                className="w-full rounded-lg bg-[#070C17] border border-slate-800 px-3.5 py-2.5 text-sm text-slate-100 placeholder:text-slate-600 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
              />
            </div>

            <div>
              <label
                htmlFor="admin-password"
                className="block text-xs font-medium text-slate-300 mb-1.5"
              >
                Password
              </label>
              <div className="relative">
                <input
                  id="admin-password"
                  type="password"
                  autoComplete={isSetupMode ? 'new-password' : 'current-password'}
                  required
                  minLength={isSetupMode ? 8 : 1}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={isSetupMode ? 'Minimum 8 characters' : 'Enter password'}
                  className="w-full rounded-lg bg-[#070C17] border border-slate-800 px-3.5 py-2.5 pr-10 text-sm text-slate-100 placeholder:text-slate-600 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                />
                <KeyRound
                  className="w-4 h-4 text-slate-500 absolute right-3.5 top-1/2 -translate-y-1/2 pointer-events-none"
                  aria-hidden="true"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="w-full min-h-[44px] mt-2 inline-flex items-center justify-center gap-2 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-60 disabled:cursor-not-allowed px-4 py-2.5 text-sm font-medium text-white transition-colors cursor-pointer whitespace-nowrap"
            >
              <Lock className="w-4 h-4" aria-hidden="true" />
              <span>
                {submitting
                  ? 'Verifying...'
                  : isSetupMode
                    ? 'Create Admin & Enter Console'
                    : 'Sign In to Console'}
              </span>
              <ArrowRight className="w-4 h-4" aria-hidden="true" />
            </button>
          </form>

          {bootstrap.authMode === 'server_local' && (
            <p className="mt-5 text-xs leading-relaxed text-slate-500">
              To switch to Supabase Authentication, configure{' '}
              <code className="font-mono text-slate-300">VITE_SUPABASE_URL</code>,{' '}
              <code className="font-mono text-slate-300">VITE_SUPABASE_ANON_KEY</code>, and server
              service role secrets.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
