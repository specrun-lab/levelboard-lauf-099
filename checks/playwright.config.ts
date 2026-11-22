import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  retries: 0,
  timeout: 15000,
  workers: 1,
  reporter: [
    ['list'],
    ['json', { outputFile: '.out/playwright.json' }],
  ],
  use: {
    baseURL: process.env.BASE_URL || 'http://127.0.0.1:8080',
  },
  projects: [
    { name: 'levels', testMatch: /level[1-9]\.spec\.ts$/ },
    { name: 'level-10', testMatch: /level10\.spec\.ts$/, dependencies: ['levels'] },
    { name: 'weitere', testMatch: /(container|live-report)\.spec\.ts$/ },
  ],
});
