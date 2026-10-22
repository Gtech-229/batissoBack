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
    // Setup hooks hash PINs and passwords with scrypt and build a whole app per
    // file: on a loaded machine (Docker Desktop on Windows) they went past the
    // 10 s hook / 5 s test defaults at random, in a different file each time,
    // while every file passed alone. A real hang still fails, after 30 s.
    hookTimeout: 30_000,
    testTimeout: 30_000,
  },
});
