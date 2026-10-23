import { defineConfig } from 'vite'
import fs from 'fs'
import path from 'path'

const GLUE_FILE = 'web-ifc-pthread-glue.js'
const SCRIPT_DIR = 'var _scriptDir = typeof document !== "undefined" && document.currentScript ? document.currentScript.src : void 0;'

function writeThreadGlue(fromDir, toDir) {
  const source = fs.readFileSync(path.join(fromDir, 'web-ifc-api.js'), 'utf8')
  const start = source.indexOf('var WebIFCWasm2 = (() => {')
  const end = source.indexOf('if (typeof exports === "object" && typeof module === "object")', start)
  if (start < 0 || end < 0) return
  const factory = source.slice(start, end).trim().replace('var WebIFCWasm2 =', 'var WebIFCWasm =')
  const glue = factory.replace(SCRIPT_DIR, `var _scriptDir = "/${GLUE_FILE}";`)
  fs.writeFileSync(path.join(toDir, GLUE_FILE), glue)
}

function copyIfcWasm() {
  return {
    name: 'copy-ifc-wasm',
    buildStart() {
      const fromDir = path.resolve('node_modules/web-ifc')
      const toDir = path.resolve('public')
      fs.mkdirSync(toDir, { recursive: true })
      for (const file of ['web-ifc.wasm', 'web-ifc-mt.wasm', 'web-ifc-mt.worker.js']) {
        const from = path.join(fromDir, file)
        if (fs.existsSync(from)) fs.copyFileSync(from, path.join(toDir, file))
      }
      writeThreadGlue(fromDir, toDir)
    },
    transform(code, id) {
      const normalized = id.replace(/\\/g, '/')
      if (!normalized.includes('/node_modules/web-ifc/web-ifc-api.js')) return
      const index = code.indexOf(SCRIPT_DIR)
      if (index < 0) return
      return code.slice(0, index) + `var _scriptDir = "/${GLUE_FILE}";` + code.slice(index + SCRIPT_DIR.length)
    }
  }
}

const isolationHeaders = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp'
}

export default defineConfig({
  plugins: [copyIfcWasm()],
  optimizeDeps: {
    exclude: ['web-ifc']
  },
  server: {
    port: 5173,
    strictPort: true,
    headers: isolationHeaders
  },
  preview: {
    headers: isolationHeaders
  }
})
