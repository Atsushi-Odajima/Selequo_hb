import { defineConfig, devices } from '@playwright/test';

const port = 8799;
export default defineConfig({
  testDir: 'e2e',
  timeout: 90_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list'], ['json', { outputFile: 'test-results/e2e-results.json' }]],
  use: { baseURL: `http://localhost:${port}`, trace: 'retain-on-failure', screenshot: 'only-on-failure', actionTimeout: 15_000 },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
  ],
  webServer: {
    // fresh database per run; AI provider is the deterministic mock so "AI OFF → 0 calls" is meaningful
    command: `rm -rf .e2e-data && npm run build && node dist/server/server/main.js`,
    url: `http://localhost:${port}/api/health`,
    timeout: 180_000,
    reuseExistingServer: false,
    env: {
      PORT: String(port),
      SELEQUO_DATA_DIR: '.e2e-data',
      SELEQUO_SECRET: 'e2e-secret-'.padEnd(64, 'x'),
      SELEQUO_FETCH_FIXTURES: 'fixtures/sample',
      AI_PROVIDER: 'mock',
      NODE_ENV: 'development',
    },
  },
});
