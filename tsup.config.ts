import { defineConfig } from 'tsup'

export default defineConfig({
    entry: ['src/index.ts', 'src/stdio.ts', 'src/http.ts'],
    format: ['esm'],
    target: 'node20',
    platform: 'node',
    dts: { entry: 'src/index.ts' },
    clean: true,
    splitting: true,
    sourcemap: false,
})
