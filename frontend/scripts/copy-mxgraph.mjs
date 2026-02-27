import fs from 'fs'
import path from 'path'

const src = path.resolve('node_modules/mxgraph/javascript/src')
const dst = path.resolve('public/mxgraph')

function copyDir(from, to) {
  if (!fs.existsSync(from)) return
  fs.mkdirSync(to, { recursive: true })
  for (const ent of fs.readdirSync(from, { withFileTypes: true })) {
    const a = path.join(from, ent.name)
    const b = path.join(to, ent.name)
    if (ent.isDirectory()) copyDir(a, b)
    else fs.copyFileSync(a, b)
  }
}

copyDir(src, dst)
console.log(`mxgraph assets copied to ${dst}`)
