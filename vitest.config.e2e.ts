import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

// E2E tests run against the batisso_test database. Variables already set here
// take precedence over .env, which ConfigModule loads afterwards.
process.loadEnvFile('.env.test');

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    root: './',
    include: ['**/*.e2e-spec.ts'],
    globalSetup: ['./test/global-setup.ts'],
    // Test files share one database; run them one after another.
    fileParallelism: false,
  },
});
