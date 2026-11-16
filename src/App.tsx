import { useCallback, useEffect, useState } from 'react';
import {
  History,
  LayoutDashboard,
  Link2,
  LogOut,
  Menu,
  Server,
  ShieldCheck,
  X,
} from 'lucide-react';
import { AdminLoginView } from './components/AdminLoginView.tsx';
import { ConsentPageView } from './components/ConsentPageView.tsx';
import { NewInvitationView } from './components/NewInvitationView.tsx';
import { RustDeskEngineView } from './components/RustDeskEngineView.tsx';
import { SessionHistoryView } from './components/SessionHistoryView.tsx';
import { SessionsOverviewView } from './components/SessionsOverviewView.tsx';
import { apiClient } from './lib/apiClient.ts';
import { getSupabaseClient } from './lib/supabase.ts';
import type {
  AdminUser,
  DashboardBootstrapInfo,
  RustDeskPublicConfig,
  SupportSession,
} from './types/meridian.ts';

type DashboardTab = 'overview' | 'new_invitation' | 'history' | 'engine';

const LOCAL_TOKEN_STORAGE_KEY = 'meridian_admin_session_token';

function extractConsentTokenFromPath(pathname: string): string | null {
  const match = pathname.match(/^\/consent\/([^/]+)\/?$/);
  return match ? decodeURIComponent(match[1]) : null;
}

export default function App() {
  const [pathname, setPathname] = useState(() => window.location.pathname);
  const [bootstrap, setBootstrap] = useState<DashboardBootstrapInfo | null>(null);
  const [bootstrapError, setBootstrapError] = useState<string | null>(null);
  const [admin, setAdmin] = useState<AdminUser | null>(null);
  const [authToken, setAuthToken] = useState<string | null>(null);
  const [authChecking, setAuthChecking] = useState(true);

  const [activeTab, setActiveTab] = useState<DashboardTab>('overview');
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  const [sessions, setSessions] = useState<SupportSession[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [rustdeskConfig, setRustdeskConfig] = useState<RustDeskPublicConfig | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());

  const consentToken = extractConsentTokenFromPath(pathname);

  const navigate = useCallback((nextPath: string) => {
    window.history.pushState({}, '', nextPath);
    setPathname(nextPath);
  }, []);

  useEffect(() => {
    const handlePopState = () => setPathname(window.location.pathname);
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  // Load bootstrap config & restore existing admin session
  useEffect(() => {
    let mounted = true;
    async function init() {
      try {
        const info = await apiClient.getBootstrap();
        if (!mounted) return;
        setBootstrap(info);

        if (info.authMode === 'supabase') {
          const supabase = getSupabaseClient();
          if (supabase) {
            const { data } = await supabase.auth.getSession();
            if (data.session?.access_token && data.session.user?.email) {
              const user: AdminUser = {
                id: data.session.user.id,
                email: data.session.user.email,
                displayName:
                  typeof data.session.user.user_metadata?.display_name === 'string'
                    ? data.session.user.user_metadata.display_name
                    : data.session.user.email.split('@')[0],
                role: 'admin',
                authProvider: 'supabase',
              };
              if (mounted) {
                setAdmin(user);
                setAuthToken(data.session.access_token);
              }
            }
          }
        } else {
          const saved = window.sessionStorage.getItem(LOCAL_TOKEN_STORAGE_KEY);
          if (saved) {
            try {
              const { user } = await apiClient.getMe(saved);
              if (mounted) {
                setAdmin(user);
                setAuthToken(saved);
              }
            } catch {
              window.sessionStorage.removeItem(LOCAL_TOKEN_STORAGE_KEY);
            }
          }
        }
      } catch (err) {
        if (mounted) {
          setBootstrapError(
            err instanceof Error ? err.message : 'Unable to connect to MERIDIAN backend.'
          );
        }
      } finally {
        if (mounted) setAuthChecking(false);
      }
    }
    init();
    return () => {
      mounted = false;
    };
  }, []);

  const refreshDashboardData = useCallback(
    async (token: string, silent = false) => {
      if (!silent) setSessionsLoading(true);
      try {
        const [sessionsRes, configRes] = await Promise.all([
          apiClient.listSessions(token),
          apiClient.getRustDeskConfig(token),
        ]);
        setSessions(sessionsRes.sessions);
        setRustdeskConfig(configRes.config);
      } catch (err) {
        console.error('Failed to sync sessions:', err);
      } finally {
        if (!silent) setSessionsLoading(false);
      }
    },
    []
  );

  useEffect(() => {
    if (!authToken || !admin) return;
    refreshDashboardData(authToken, false);
    const interval = setInterval(() => refreshDashboardData(authToken, true), 6000);
    return () => clearInterval(interval);
  }, [authToken, admin, refreshDashboardData]);

  function handleAuthenticated(user: AdminUser, token: string) {
    setAdmin(user);
    setAuthToken(token);
    if (user.authProvider === 'server_local') {
      window.sessionStorage.setItem(LOCAL_TOKEN_STORAGE_KEY, token);
    }
  }

  async function handleSignOut() {
    if (admin?.authProvider === 'supabase') {
      const supabase = getSupabaseClient();
      if (supabase) await supabase.auth.signOut();
    }
    window.sessionStorage.removeItem(LOCAL_TOKEN_STORAGE_KEY);
    setAdmin(null);
    setAuthToken(null);
    setSessions([]);
    setRustdeskConfig(null);
    apiClient
      .getBootstrap()
      .then((info) => setBootstrap(info))
      .catch(() => {});
  }

  function handleSessionCreated(session: SupportSession) {
    setSessions((prev) => [session, ...prev.filter((s) => s.id !== session.id)]);
  }

  function handleSessionUpdated(updated: SupportSession) {
    setSessions((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
  }

  // Public Recipient Consent Page Route (/consent/:token)
  if (consentToken) {
    return (
      <ConsentPageView
        token={consentToken}
        hasAdminSession={Boolean(admin && authToken)}
        onBackToConsole={() => navigate('/')}
      />
    );
  }

  if (bootstrapError) {
    return (
      <div className="min-h-screen bg-[#070C17] text-slate-100 flex items-center justify-center p-6">
        <div className="max-w-md w-full bg-[#0D1526] border border-slate-800 rounded-xl p-6 text-center">
          <h1 className="font-display text-lg font-semibold text-white mb-2">
            Service unavailable
          </h1>
          <p className="text-xs text-slate-400">{bootstrapError}</p>
        </div>
      </div>
    );
  }

  if (authChecking || !bootstrap) {
    return (
      <div className="min-h-screen bg-[#070C17] text-slate-100 flex items-center justify-center p-6">
        <div className="text-xs text-slate-400">Initializing MERIDIAN Remote Access...</div>
      </div>
    );
  }

  if (!admin || !authToken) {
    return <AdminLoginView bootstrap={bootstrap} onAuthenticated={handleAuthenticated} />;
  }

  const navItems: Array<{ id: DashboardTab; label: string; icon: typeof LayoutDashboard }> = [
    { id: 'overview', label: 'Overview', icon: LayoutDashboard },
    { id: 'new_invitation', label: 'New Invitation', icon: Link2 },
    { id: 'history', label: 'Session History', icon: History },
    { id: 'engine', label: 'RustDesk Engine', icon: Server },
  ];

  const tabTitles: Record<DashboardTab, string> = {
    overview: 'Operations Overview',
    new_invitation: 'New Support Invitation',
    history: 'Session History',
    engine: 'RustDesk & Deployment',
  };

  return (
    <div className="min-h-screen bg-[#070C17] text-slate-100 flex">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex lg:w-64 lg:flex-col lg:fixed lg:inset-y-0 bg-[#0B1221] border-r border-slate-800/80">
        <div className="h-16 px-6 flex items-center gap-2.5 border-b border-slate-800/80">
          <div className="w-8 h-8 rounded-lg bg-blue-600/15 border border-blue-500/30 flex items-center justify-center text-blue-400 shrink-0">
            <ShieldCheck className="w-4 h-4" aria-hidden="true" />
          </div>
          <span className="font-display text-sm font-semibold tracking-tight text-white whitespace-nowrap">
            MERIDIAN
          </span>
        </div>

        <nav className="flex-1 px-3 py-5 space-y-1" aria-label="Primary navigation">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveTab(item.id)}
                className={`w-full min-h-[40px] flex items-center gap-3 px-3.5 py-2 rounded-lg text-xs font-medium transition-colors cursor-pointer whitespace-nowrap ${
                  active
                    ? 'bg-blue-600/15 text-blue-400 border border-blue-500/30'
                    : 'text-slate-400 hover:text-slate-100 hover:bg-slate-800/40 border border-transparent'
                }`}
              >
                <Icon className="w-4 h-4 shrink-0" aria-hidden="true" />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="p-4 border-t border-slate-800/80">
          <div className="px-2 mb-3">
            <div className="text-xs font-medium text-slate-200 truncate">{admin.displayName}</div>
            <div className="text-[11px] text-slate-500 truncate">{admin.email}</div>
          </div>
          <button
            type="button"
            onClick={handleSignOut}
            className="w-full min-h-[38px] flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-medium text-slate-400 hover:text-white hover:bg-slate-800/60 transition-colors cursor-pointer"
          >
            <LogOut className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Sign Out</span>
          </button>
        </div>
      </aside>

      {/* Mobile Navigation Drawer */}
      {mobileNavOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div
            className="fixed inset-0 bg-black/70"
            onClick={() => setMobileNavOpen(false)}
            aria-hidden="true"
          />
          <aside className="relative w-64 max-w-[80vw] bg-[#0B1221] border-r border-slate-800 flex flex-col z-10">
            <div className="h-16 px-5 flex items-center justify-between border-b border-slate-800">
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-blue-400" aria-hidden="true" />
                <span className="font-display text-sm font-semibold text-white">MERIDIAN</span>
              </div>
              <button
                type="button"
                onClick={() => setMobileNavOpen(false)}
                className="p-2 text-slate-400 hover:text-white"
                aria-label="Close navigation"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <nav className="flex-1 p-3 space-y-1">
              {navItems.map((item) => {
                const Icon = item.icon;
                const active = activeTab === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      setActiveTab(item.id);
                      setMobileNavOpen(false);
                    }}
                    className={`w-full min-h-[44px] flex items-center gap-3 px-3.5 py-2.5 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
                      active
                        ? 'bg-blue-600/15 text-blue-400 border border-blue-500/30'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    <Icon className="w-4 h-4 shrink-0" aria-hidden="true" />
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </nav>
            <div className="p-4 border-t border-slate-800">
              <div className="text-xs text-slate-300 truncate mb-2">{admin.email}</div>
              <button
                type="button"
                onClick={handleSignOut}
                className="w-full min-h-[44px] flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium text-slate-300 bg-slate-900 border border-slate-800"
              >
                <LogOut className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Sign Out</span>
              </button>
            </div>
          </aside>
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex-1 lg:pl-64 flex flex-col min-w-0">
        <header className="h-16 px-4 sm:px-8 border-b border-slate-800/80 bg-[#070C17]/90 backdrop-blur flex items-center justify-between gap-4 sticky top-0 z-30">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileNavOpen(true)}
              className="lg:hidden p-2 -ml-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800/60"
              aria-label="Open navigation"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="flex items-center gap-2 text-xs text-slate-400 truncate">
              <span className="hidden sm:inline">MERIDIAN Console</span>
              <span className="hidden sm:inline" aria-hidden="true">
                /
              </span>
              <h1 className="font-display text-sm sm:text-base font-semibold text-white truncate">
                {tabTitles[activeTab]}
              </h1>
            </div>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            {activeTab !== 'new_invitation' && (
              <button
                type="button"
                onClick={() => setActiveTab('new_invitation')}
                className="min-h-[38px] inline-flex items-center gap-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 px-3.5 py-1.5 text-xs font-medium text-white transition-colors cursor-pointer whitespace-nowrap shrink-0"
              >
                <Link2 className="w-3.5 h-3.5" aria-hidden="true" />
                <span>New Invitation</span>
              </button>
            )}
          </div>
        </header>

        <main className="flex-1 px-4 sm:px-8 py-6 max-w-7xl w-full mx-auto">
          {activeTab === 'overview' && (
            <SessionsOverviewView
              authToken={authToken}
              sessions={sessions}
              rustdeskConfig={rustdeskConfig}
              loading={sessionsLoading}
              nowMs={nowMs}
              onCreateNewClick={() => setActiveTab('new_invitation')}
              onSessionUpdated={handleSessionUpdated}
              onOpenConsentPreview={(token) => navigate(`/consent/${token}`)}
            />
          )}

          {activeTab === 'new_invitation' && (
            <NewInvitationView
              authToken={authToken}
              nowMs={nowMs}
              onSessionCreated={handleSessionCreated}
              onSessionUpdated={handleSessionUpdated}
              onOpenConsentPreview={(token) => navigate(`/consent/${token}`)}
            />
          )}

          {activeTab === 'history' && (
            <SessionHistoryView
              authToken={authToken}
              sessions={sessions}
              loading={sessionsLoading}
              nowMs={nowMs}
              onSessionUpdated={handleSessionUpdated}
            />
          )}

          {activeTab === 'engine' && (
            <RustDeskEngineView
              authToken={authToken}
              bootstrap={bootstrap}
              config={rustdeskConfig}
              onConfigUpdated={(cfg) => setRustdeskConfig(cfg)}
            />
          )}
        </main>
      </div>
    </div>
  );
}
