import 'dotenv/config';
import express, { type NextFunction, type Request, type Response } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import {
  authenticateBearerToken,
  createInvitation,
  endSessionByAdmin,
  getBootstrapInfo,
  getPublicConsentDetails,
  getRustDeskPublicConfig,
  listSessionsForAdmin,
  loginLocalAdmin,
  recordLinkCopied,
  registerInitialAdmin,
  respondToConsent,
  updateRustDeskConfig,
} from './src/server/store.ts';
import type { AccessScope, AdminUser, DevicePlatform } from './src/types/meridian.ts';

interface AuthedRequest extends Request {
  admin?: AdminUser;
}

const PORT = Number(process.env.PORT || 3000);
const isProduction = process.env.NODE_ENV === 'production';

async function requireAdmin(req: AuthedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const admin = await authenticateBearerToken(req.headers.authorization);
    if (!admin) {
      res.status(401).json({ error: 'Unauthorized: Valid administrator token required.' });
      return;
    }
    req.admin = admin;
    next();
  } catch (err) {
    console.error('Admin auth verification error:', err);
    res.status(401).json({ error: 'Unauthorized: Authentication verification failed.' });
  }
}

async function startServer(): Promise<void> {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '256kb' }));

  // Health & bootstrap metadata (public, zero secrets)
  app.get('/api/bootstrap', async (_req: Request, res: Response) => {
    try {
      const info = await getBootstrapInfo();
      res.json(info);
    } catch (err) {
      console.error('Bootstrap error:', err);
      res.status(500).json({ error: 'Failed to inspect server configuration.' });
    }
  });

  // Standalone local-server Admin Auth endpoints (disabled when Supabase Auth is active)
  app.post('/api/auth/register', async (req: Request, res: Response) => {
    try {
      const { email, password, displayName } = req.body as {
        email?: string;
        password?: string;
        displayName?: string;
      };
      const result = await registerInitialAdmin(email ?? '', password ?? '', displayName ?? '');
      res.status(201).json(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unable to register admin account.';
      res.status(400).json({ error: message });
    }
  });

  app.post('/api/auth/login', async (req: Request, res: Response) => {
    try {
      const { email, password } = req.body as { email?: string; password?: string };
      const result = await loginLocalAdmin(email ?? '', password ?? '');
      res.json(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Invalid credentials.';
      res.status(401).json({ error: message });
    }
  });

  app.get('/api/auth/me', requireAdmin, (req: AuthedRequest, res: Response) => {
    res.json({ user: req.admin });
  });

  // Public Recipient Consent Endpoints (token-authorized, zero credential collection)
  app.get('/api/consent/:token', async (req: Request, res: Response) => {
    try {
      const token = String(req.params.token || '');
      const details = await getPublicConsentDetails(token);
      if (!details) {
        res.status(404).json({ error: 'This invitation link is invalid or no longer exists.' });
        return;
      }
      res.json(details);
    } catch (err) {
      console.error('Consent lookup error:', err);
      res.status(500).json({ error: 'Failed to verify invitation token.' });
    }
  });

  app.post('/api/consent/:token/respond', async (req: Request, res: Response) => {
    try {
      const token = String(req.params.token || '');
      const { decision, rustdeskPeerId } = req.body as {
        decision?: 'allow' | 'reject' | 'end';
        rustdeskPeerId?: string;
      };
      if (decision !== 'allow' && decision !== 'reject' && decision !== 'end') {
        res.status(400).json({ error: 'Invalid consent decision.' });
        return;
      }
      const updated = await respondToConsent(token, decision, rustdeskPeerId);
      if (!updated) {
        res.status(404).json({ error: 'Invitation link not found.' });
        return;
      }
      res.json(updated);
    } catch (err) {
      console.error('Consent response error:', err);
      res.status(500).json({ error: 'Failed to process consent response.' });
    }
  });

  // Admin-Protected Session & Invitation Endpoints
  app.get('/api/invitations', requireAdmin, async (req: AuthedRequest, res: Response) => {
    try {
      const sessions = await listSessionsForAdmin(req.admin!);
      res.json({ sessions });
    } catch (err) {
      console.error('List invitations error:', err);
      res.status(500).json({ error: 'Failed to load sessions.' });
    }
  });

  app.post('/api/invitations', requireAdmin, async (req: AuthedRequest, res: Response) => {
    try {
      const { platform, recipientLabel, ttlMinutes, accessScope } = req.body as {
        platform?: DevicePlatform;
        recipientLabel?: string;
        ttlMinutes?: number;
        accessScope?: AccessScope;
      };
      if (platform !== 'windows' && platform !== 'android') {
        res.status(400).json({ error: 'Target platform must be windows or android.' });
        return;
      }
      const scope: AccessScope = accessScope === 'view_only' ? 'view_only' : 'assisted_control';
      const session = await createInvitation(req.admin!, {
        platform,
        recipientLabel: String(recipientLabel ?? ''),
        ttlMinutes: Number(ttlMinutes || 30),
        accessScope: scope,
      });
      res.status(201).json({ session });
    } catch (err) {
      console.error('Create invitation error:', err);
      res.status(500).json({ error: 'Failed to create temporary invitation link.' });
    }
  });

  app.post('/api/sessions/:id/copied', requireAdmin, async (req: AuthedRequest, res: Response) => {
    try {
      const session = await recordLinkCopied(req.admin!, String(req.params.id));
      if (!session) {
        res.status(404).json({ error: 'Session not found.' });
        return;
      }
      res.json({ session });
    } catch (err) {
      console.error('Record copy error:', err);
      res.status(500).json({ error: 'Failed to record link copy event.' });
    }
  });

  app.post('/api/sessions/:id/end', requireAdmin, async (req: AuthedRequest, res: Response) => {
    try {
      const session = await endSessionByAdmin(req.admin!, String(req.params.id));
      if (!session) {
        res.status(404).json({ error: 'Session not found.' });
        return;
      }
      res.json({ session });
    } catch (err) {
      console.error('End session error:', err);
      res.status(500).json({ error: 'Failed to end session.' });
    }
  });

  // RustDesk Relay Configuration (public host/key metadata; private API keys never leave server env)
  app.get('/api/rustdesk/config', requireAdmin, async (_req: AuthedRequest, res: Response) => {
    try {
      const config = await getRustDeskPublicConfig();
      res.json({ config });
    } catch (err) {
      console.error('RustDesk config read error:', err);
      res.status(500).json({ error: 'Failed to read RustDesk configuration.' });
    }
  });

  app.put('/api/rustdesk/config', requireAdmin, async (req: AuthedRequest, res: Response) => {
    try {
      const { hbbsHost, hbbrHost, publicKey } = req.body as {
        hbbsHost?: string;
        hbbrHost?: string;
        publicKey?: string;
      };
      const config = await updateRustDeskConfig(req.admin!, {
        hbbsHost: String(hbbsHost ?? ''),
        hbbrHost: String(hbbrHost ?? ''),
        publicKey: String(publicKey ?? ''),
      });
      res.json({ config });
    } catch (err) {
      console.error('RustDesk config update error:', err);
      res.status(500).json({ error: 'Failed to save RustDesk configuration.' });
    }
  });

  if (!isProduction) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req: Request, res: Response) => {
      const indexFile = path.join(distDir, 'index.html');
      if (fs.existsSync(indexFile)) {
        res.sendFile(indexFile);
      } else {
        res.status(404).send('Build output not found. Run npm run build first.');
      }
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`MERIDIAN Remote Access server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Fatal server startup error:', err);
  process.exit(1);
});
