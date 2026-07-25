import { defineConfig } from 'vite';
import solid from 'vite-plugin-solid';

export default defineConfig({
  plugins: [solid()],
  optimizeDeps: {
    include: [
      '@polywatch/core/market-list',
      '@polywatch/core/risk/sim-mode-fields',
      '@polywatch/core/algo/surveillance-constants',
      '@polywatch/core/positions/redemption-wait',
      '@polywatch/core/simulation/trader-analytics',
      '@polywatch/core/simulation/trader-pnl-series',
      '@polywatch/core/simulation/market-analytics',
      '@polywatch/core/types/trader-analytics',
      '@polywatch/core/types/market-analytics',
      '@polywatch/core/market/nav-category',
      '@polywatch/core/worker/move-detector-settings',
      '@polywatch/core/simulation/constants',
      '@polywatch/core/polymarket/pusd-amount',
      '@polywatch/core/polymarket/trading-wallet',
      '@polywatch/core/lib/algo-price-tick.types',
      '@polywatch/core/weather/question-parser',
    ],
    exclude: ['typeorm', 'reflect-metadata'],
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3000',
      '/market-icons': 'http://localhost:3000',
      '/socket.io': {
        target: 'http://localhost:3000',
        ws: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    rollupOptions: {
      external: [
        'ioredis',
        'pino',
        'node:crypto',
        'node:fs',
        'node:path',
        'node:url',
        'crypto',
        'path',
        'os',
        'stream',
        'net',
        'tls',
        'events',
        'util',
        'assert',
      ],
    },
  },
});
