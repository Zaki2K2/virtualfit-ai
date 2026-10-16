import { defineConfig } from 'vitest/config';
// Sharp/Mongoose-heavy suites should not compete with the local model for all RAM.
export default defineConfig({ test: { environment: 'node', include: ['src/**/*.test.ts'], maxWorkers: 2 } });
