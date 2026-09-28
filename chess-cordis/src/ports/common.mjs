// 共享助手：perft 计数、Move→UCI、native/subprocess 引擎注册封装。
// 这些代码属于 HARNESS 层（chess-cordis），不属于任何独立引擎。

import { chessRegistry } from '../registry.mjs'

// 通用 Move→UCI：row 0 = 第 8 横线（rank 8），故 rank = 8 - row。
// 兼容 camelCase（js/ts）与 snake_case（py）字段名。
export function moveToUci(mv) {
  const fr = mv.fromRow ?? mv.from_row
  const fc = mv.fromCol ?? mv.from_col
  const tr = mv.toRow ?? mv.to_row
  const tc = mv.toCol ?? mv.to_col
  const promo = (mv.promotion ?? mv.promo ?? '.')
  const files = 'abcdefgh'
  let s = files[fc] + (8 - fr) + files[tc] + (8 - tr)
  if (promo && promo !== '.') s += String(promo).toLowerCase()
  return s
}

// 通用 perft：依赖引擎提供的 Rules + clone + applyMove。
export function makePerft({ clone, applyMove, generateAllLegalMoves }) {
  function perft(state, depth) {
    if (depth === 0) return 1
    const moves = generateAllLegalMoves(state)
    if (depth === 1) return moves.length
    let count = 0
    for (const m of moves) {
      const child = clone(state)
      applyMove(child, m, false)
      count += perft(child, depth - 1)
    }
    return count
  }
  return perft
}

// native 引擎注册：直接 import 引擎核心，登记到共享 registry。
// 清理用 ctx.effect 回滚（时间维可逆效应）—— native 引擎无子进程，回滚即反注册。
export function registerNative(ctx, { id, language, api }) {
  const full = { id, language, kind: 'native', ...api }
  chessRegistry.register(id, full)
  ctx.effect(() => {
    return () => { chessRegistry.unregister(id) }
  }, `register-${id}`)
  return full
}

// subprocess 引擎注册：登记 api（其内已持有子进程句柄），清理由调用方用
// ctx.effect 杀掉子进程。本封装仅登记 + 反注册。
export function registerSubprocess(ctx, { id, language, api }) {
  const full = { id, language, kind: 'subprocess', ...api }
  chessRegistry.register(id, full)
  ctx.effect(() => {
    return () => { chessRegistry.unregister(id) }
  }, `register-${id}`)
  return full
}
