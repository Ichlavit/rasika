// @ts-check
import { defineConfig } from 'astro/config';

// https://astro.build/config
const lowMemoryBuild = process.env.RASIKA_LOW_MEMORY_BUILD === '1';

export default defineConfig({
  vite: lowMemoryBuild
    ? {
        build: {
          minify: false,
          reportCompressedSize: false,
          rollupOptions: {
            maxParallelFileOps: 1,
          },
        },
      }
    : undefined,
});
