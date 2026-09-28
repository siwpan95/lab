// 通用 subprocess 端口（harness 层适配器）：spawn 一个引擎驱动进程，经行分隔 JSON
// 协议驱动 perft / legalMoves / bestMove。清理用 ctx.effect 回滚 = 杀掉子进程
// （论文时间维：可逆效应）。子进程驱动脚本位于 chess-cordis/drivers/（harness 侧），
// 引擎目录本身不含任何 cordis / JSON-stdio 代码。
import { spawn } from 'node:child_process'
import { chessRegistry } from '../registry.mjs'
import { registerSubprocess } from './common.mjs'

export default function subprocessPort(ctx, config = {}) {
  const id = config.id
  if (!id) throw new Error('subprocess port requires config.id')
  const cmd = config.cmd
  const args = config.args ?? []
  const cwd = config.cwd
  const timeout = config.timeout ?? 15000

  const proc = spawn(cmd, args, { cwd, stdio: ['pipe', 'pipe', 'pipe'] })
  let buffer = ''
  let ready = false
  const pending = new Map()
  let seq = 0

  proc.stdout.setEncoding('utf8')
  proc.stdout.on('data', (chunk) => {
    buffer += chunk
    let idx
    while ((idx = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, idx).trim()
      buffer = buffer.slice(idx + 1)
      if (!line) continue
      let msg
      try { msg = JSON.parse(line) } catch { continue }
      if (msg.ready) { ready = true; continue }
      const cb = pending.get(msg.id)
      if (cb) { pending.delete(msg.id); cb(msg) }
    }
  })
  proc.stderr.on('data', () => {})

  function rpc(cmdName, fen, depth) {
    return new Promise((resolve, reject) => {
      const rid = String(++seq)
      const timer = setTimeout(() => {
        pending.delete(rid)
        reject(new Error(`timeout: ${cmdName} ${fen}`))
      }, timeout)
      pending.set(rid, (msg) => {
        clearTimeout(timer)
        resolve(msg)
      })
      proc.stdin.write(JSON.stringify({ id: rid, cmd: cmdName, fen, depth }) + '\n')
    })
  }

  const api = {
    language: config.language,
    pid: proc.pid,
    alive: () => !proc.killed && proc.exitCode === null,
    async perft(fen, depth) {
      const r = await rpc('perft', fen, depth)
      if (!r.ok) throw new Error(r.error || 'perft failed')
      return r.nodes
    },
    async legalMoves(fen) {
      const r = await rpc('legalMoves', fen, 1)
      if (!r.ok) throw new Error(r.error || 'legalMoves failed')
      return r.moves
    },
    async bestMove(fen, depth = 3) {
      const r = await rpc('bestMove', fen, depth)
      if (!r.ok) throw new Error(r.error || 'bestMove failed')
      return { move: r.move, score: r.score ?? 0 }
    },
  }

  // 注册；清理 = 杀掉子进程（可逆效应 / 时间维热插拔）
  registerSubprocess(ctx, { id, language: config.language, api })
  ctx.effect(() => {
    return () => {
      try { proc.kill('SIGKILL') } catch {}
    }
  }, `kill-${id}`)

  return api
}
