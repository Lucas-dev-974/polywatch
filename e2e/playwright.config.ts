import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  use: {
    baseURL: 'http://localhost:5173',
  },
  webServer: [
    {
      command: 'npm run dev -w @polywatch/backend',
      port: 3000,
      reuseExistingServer: true,
    },
    {
      command: 'npm run dev -w @polywatch/frontend',
      port: 5173,
      reuseExistingServer: true,
    },
  ],
});
