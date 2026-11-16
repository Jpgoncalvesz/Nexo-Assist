import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.e2e.ts',
  workers: 1,
  fullyParallel: false,
  use: {
    baseURL: 'http://127.0.0.1:3100',
    headless: true,
    channel: 'msedge',
    screenshot: 'only-on-failure',
  },
  reporter: [['list']],
  timeout: 45000,
});
