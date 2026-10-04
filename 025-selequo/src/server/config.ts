import { randomBytes } from 'node:crypto';

export interface Config {
  env: 'development' | 'test' | 'production';
  port: number;
  host: string;
  appVersion: string;
  databaseUrl?: string;
  pgliteDir?: string; // undefined → in-memory
  dataDir: string;
  secret: string; // HMAC secret for signed URLs
  publicUrl: string;
  aiProvider: 'none' | 'anthropic' | 'mock';
  anthropicApiKey?: string;
  anthropicModel: string;
  fetchFixturesDir?: string; // dev/test only: serves https://*.selequo.invalid/* from local files
  fetchAllowPorts: number[];
  maxUploadBytes: number;
  maxFetchBytes: number;
  pdfRenderer: 'chromium' | 'none';
  cookieSecure: boolean;
  signupEnabled: boolean;
  trustProxy: boolean | number | string; // number of proxy hops or proxy IPs; never blindly `true`
}

export function loadConfig(overrides: Partial<Config> = {}): Config {
  const env = (process.env.NODE_ENV as Config['env']) ?? 'development';
  const secret = process.env.SELEQUO_SECRET ?? (env === 'production' ? '' : randomBytes(32).toString('hex'));
  const cfg: Config = {
    env,
    port: Number(process.env.PORT ?? 8787),
    host: process.env.HOST ?? '127.0.0.1',
    appVersion: process.env.npm_package_version ?? '0.1.0',
    databaseUrl: process.env.DATABASE_URL || undefined,
    pgliteDir: process.env.PGLITE_DIR || undefined,
    dataDir: process.env.SELEQUO_DATA_DIR ?? './data',
    secret,
    publicUrl: process.env.PUBLIC_URL ?? 'http://localhost:8787',
    aiProvider: (process.env.AI_PROVIDER as Config['aiProvider']) ?? 'none',
    anthropicApiKey: process.env.ANTHROPIC_API_KEY || undefined,
    anthropicModel: process.env.ANTHROPIC_MODEL ?? 'claude-opus-5-5',
    fetchFixturesDir: process.env.SELEQUO_FETCH_FIXTURES || undefined,
    fetchAllowPorts: (process.env.FETCH_ALLOW_PORTS ?? '80,443').split(',').map(Number),
    maxUploadBytes: Number(process.env.MAX_UPLOAD_MB ?? 20) * 1024 * 1024,
    maxFetchBytes: Number(process.env.MAX_FETCH_MB ?? 5) * 1024 * 1024,
    pdfRenderer: (process.env.PDF_RENDERER as Config['pdfRenderer']) ?? 'chromium',
    cookieSecure: env === 'production',
    signupEnabled: process.env.SIGNUP_ENABLED !== 'false',
    trustProxy: process.env.TRUST_PROXY ? (/^\d+$/.test(process.env.TRUST_PROXY) ? Number(process.env.TRUST_PROXY) : process.env.TRUST_PROXY) : false,
    ...overrides,
  };
  if (cfg.env === 'production') {
    if (!cfg.secret || cfg.secret.length < 32) throw new Error('SELEQUO_SECRET (>=32 chars) is required in production');
    if (cfg.fetchFixturesDir) throw new Error('SELEQUO_FETCH_FIXTURES must not be set in production');
    if (!cfg.databaseUrl) throw new Error('DATABASE_URL is required in production');
  }
  return cfg;
}
