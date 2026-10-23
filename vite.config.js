import { defineConfig } from 'vite'
import fs from 'fs'
import path from 'path'

function copyIfcWasm() {
  return {
    name: 'copy-ifc-wasm',
    buildStart() {
      const fromDir = path.resolve('node_modules/web-ifc')
      const toDir = path.resolve('public')
      fs.mkdirSync(toDir, { recursive: true })
      for (const file of ['web-ifc.wasm', 'web-ifc-mt.wasm']) {
        const from = path.join(fromDir, file)
        if (fs.existsSync(from)) fs.copyFileSync(from, path.join(toDir, file))
      }
    }
  }
}

export default defineConfig({
  plugins: [copyIfcWasm()],
  server: {
    port: 5173,
    strictPort: true
  }
})
