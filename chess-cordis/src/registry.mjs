// ChessRegistry — 跨插件共享的唯一组合点（NOT a Cordis Service）。
//
// 为什么是模块单例而非 ctx Service：
//   Cordis 的 Service 按 fiber 解析；loader 把每个引擎插件挂在不同 fiber 下，
//   若把引擎注册成 Service，harness 在根 ctx 取不到子 fiber 提供的实例。
//   因此所有引擎统一登记到这个模块级单例，harness 从它读取——空间维组合由
//   loader 的声明式依赖图负责，时间维（热插拔）由每个插件登记的 ctx.effect 回滚负责。
//
// 依赖方向（唯一正确方向）：
//   chess-cordis/ports/*  (harness 层适配器)  ──import/spawn──▶  E:/lab/*Chess (独立引擎)
//   harness/loader/host  ──consume──▶  cordis-main (框架正本，不再 vendored)

export class ChessRegistry {
  constructor() {
    /** @type {Map<string, object>} id -> engine api */
    this.engines = new Map()
    this.ctx = null
    this.loaderApi = null
  }

  bindContext(ctx) { this.ctx = ctx }

  // 由 loader 插件在挂载所有引擎后绑定（unmount/mount/list 等操作真实 loader）
  bindLoader(api) { this.loaderApi = api }

  // ---- 引擎注册（由 ports 插件调用）----
  register(id, api) {
    this.engines.set(id, api)
  }
  unregister(id) {
    this.engines.delete(id)
  }
  has(id) { return this.engines.has(id) }
  get(id) { return this.engines.get(id) }
  list() { return [...this.engines.keys()] }
  snapshot() {
    return [...this.engines.entries()].map(([id, e]) => ({ id, language: e.language, kind: e.kind }))
  }

  // ---- perft 共识（空间维对齐验证）----
  // 驱动每个已挂载引擎的 perft；收集 {id,language,nodes,ok,error,ms}。
  async runPerft(fen, depth) {
    const results = []
    for (const [id, e] of this.engines) {
      const rec = { id, language: e.language, nodes: 0, ok: false, error: null, ms: 0 }
      if (typeof e.perft !== 'function') {
        rec.error = 'no perft'
        results.push(rec)
        continue
      }
      const t0 = Date.now()
      try {
        // Subprocess ports return a Promise; native ports return a number.
        // Awaiting a non-promise is a no-op, so this covers both.
        rec.nodes = await e.perft(fen, depth)
        rec.ok = typeof rec.nodes === 'number'
      } catch (err) {
        rec.error = String(err?.message ?? err)
      }
      rec.ms = Date.now() - t0
      results.push(rec)
    }
    return results
  }

  // 取各引擎节点的众数作为共识值；统计与共识偏离的引擎 id 列表。
  analyzeDivergence(results) {
    const counts = new Map()
    for (const r of results) {
      if (!r.ok) continue
      counts.set(r.nodes, (counts.get(r.nodes) || 0) + 1)
    }
    let consensus = null, best = -1
    for (const [nodes, n] of counts) {
      if (n > best) { best = n; consensus = nodes }
    }
    const diverged = results
      .filter((r) => r.ok && consensus !== null && r.nodes !== consensus)
      .map((r) => r.id)
    return { consensus, diverged }
  }

  // ---- loader 委托（时间维热插拔）----
  async loaderMountAll() { return this.loaderApi?.mountAll?.() ?? Promise.resolve() }
  async loaderEnable(id) { return this.loaderApi?.enable?.(id) }
  async loaderDisable(id) { return this.loaderApi?.disable?.(id) }

  // ---- 跨引擎 bestMove 共识（空间维对齐验证）----
  // 驱动每个已挂载引擎的 bestMove；无该能力的引擎标记 unsupported（不计入分歧）。
  async runBestMove(fen, depth) {
    const results = []
    for (const [id, e] of this.engines) {
      const rec = { id, language: e.language, move: null, score: 0, ok: false, unsupported: false, error: null, ms: 0 }
      if (typeof e.bestMove !== 'function') {
        rec.unsupported = true
        results.push(rec)
        continue
      }
      const t0 = Date.now()
      try {
        // Subprocess ports return a Promise; awaiting a non-promise is a no-op.
        const r = await e.bestMove(fen, depth)
        rec.move = r?.move ?? null
        rec.score = r?.score ?? 0
        rec.ok = !!rec.move
      } catch (err) {
        rec.error = String(err?.message ?? err)
      }
      rec.ms = Date.now() - t0
      results.push(rec)
    }
    return results
  }
}

export const chessRegistry = new ChessRegistry()
