import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './tests/browser',
  fullyParallel: false,
  workers: 1,
  timeout: 60000,
  use: { baseURL: 'http://localhost:5173', trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 1000 } } }],
  webServer: {
    command: 'npx concurrently -k "node --import tsx tests/serve.ts" "npx vite --host localhost"',
    url: 'http://127.0.0.1:3000/healthz', timeout: 60000, reuseExistingServer: false,
  },
});
