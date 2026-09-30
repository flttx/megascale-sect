import fs from 'node:fs'
import path from 'node:path'
import { defineConfig, type Plugin, lazyPlugins } from 'vite-plus'
import react from '@vitejs/plugin-react'

// Raw Tripo GLBs stay in public/ as optimizer inputs (and for ?original* dev comparisons),
// but must not ship: drop every foo.glb that has a foo.optimized.glb sibling.
function stripSourceModels(): Plugin {
  let outDir = 'dist'
  return {
    name: 'strip-source-models',
    apply: 'build',
    configResolved(config) {
      outDir = path.resolve(config.root, config.build.outDir)
    },
    closeBundle() {
      const walk = (dir: string) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          const file = path.join(dir, entry.name)
          if (entry.isDirectory()) walk(file)
          else if (
            /(?<!\.optimized|\.lod\d)\.glb$/.test(entry.name) &&
            fs.existsSync(file.replace(/\.glb$/, '.optimized.glb'))
          )
            fs.rmSync(file)
        }
      }
      if (fs.existsSync(outDir)) walk(outDir)
    },
  }
}

export default defineConfig({
  staged: {
    '*': 'vp check --fix',
  },
  fmt: { singleQuote: true, semi: false, printWidth: 120 },
  lint: {
    jsPlugins: [{ name: 'vite-plus', specifier: 'vite-plus/oxlint-plugin' }],
    rules: { 'vite-plus/prefer-vite-plus-imports': 'error' },
    options: { typeAware: true, typeCheck: true },
  },
  plugins: lazyPlugins(() => [react(), stripSourceModels()]),
  build: {
    // three alone is ~700 kB minified; split vendors so app changes don't bust their cache.
    chunkSizeWarningLimit: 900,
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            { name: 'three', test: /node_modules[\\/]three[\\/]/, priority: 30 },
            {
              name: 'r3f',
              test: /node_modules[\\/](@react-three|postprocessing|three-stdlib|maath|n8ao)[\\/]/,
              priority: 20,
            },
            {
              name: 'react',
              test: /node_modules[\\/](react|react-dom|scheduler|zustand)[\\/]/,
              priority: 10,
            },
          ],
        },
      },
    },
  },
})
