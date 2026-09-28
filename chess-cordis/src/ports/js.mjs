// js 引擎端口（harness 层适配器）：直接 import JsChess 核心，登记为 Cordis 组件。
// 引擎本身零 cordis 依赖；本文件属于 chess-cordis，是把它"收编"进 Cordis 架构的缝。
import { GameState, Rules, AIEngine } from '../../../JsChess/chessCore.js'
import { chessRegistry } from '../registry.mjs'
import { moveToUci, makePerft, registerNative } from './common.mjs'

// FEN -> JsChess.GameState（完整布置：棋盘 + 走子方 + 易位权 + 过路兵 + 计数器）
function fromFen(fen) {
  const gs = new GameState()
  // GameState() prefills the start position; clear the board before applying the
  // FEN so empty squares don't retain ghost pieces (same boundary as the C#/TS/VB
  // drivers). FEN ranks with digits leave those squares untouched otherwise.
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) gs.board[r][c] = '.'
  }
  const parts = fen.trim().split(/\s+/)
  const rows = parts[0].split('/')
  for (let r = 0; r < 8; r++) {
    let c = 0
    for (const ch of rows[r]) {
      if (ch >= '1' && ch <= '9') c += Number(ch)
      else { gs.board[r][c] = ch; c++ }
    }
  }
  gs.whiteToMove = parts[1] !== 'b'
  const castling = parts[2] ?? '-'
  gs.canCastleWK = castling.includes('K')
  gs.canCastleWQ = castling.includes('Q')
  gs.canCastleBK = castling.includes('k')
  gs.canCastleBQ = castling.includes('q')
  const ep = parts[3] ?? '-'
  gs.enPassantRow = -1
  gs.enPassantCol = -1
  if (ep !== '-' && ep.length === 2) {
    gs.enPassantCol = ep.charCodeAt(0) - 97 // 'a'
    gs.enPassantRow = 8 - Number(ep[1])
  }
  gs.halfmoveClock = parts[4] !== undefined ? Number(parts[4]) : 0
  gs.fullmoveNumber = parts[5] !== undefined ? Number(parts[5]) : 1
  gs.history = []
  gs.positionKeys = []
  return gs
}

const perft = makePerft({
  clone: (s) => s.Clone(),
  applyMove: (c, m, r) => Rules.ApplyMove(c, m, r),
  generateAllLegalMoves: (s) => Rules.GenerateAllLegalMoves(s),
})

export default function jsPort(ctx, config = {}) {
  const id = config.id ?? 'js'
  const api = {
    language: 'JavaScript',
    perft(fen, depth) {
      return perft(fromFen(fen), depth)
    },
    legalMoves(fen) {
      return Rules.GenerateAllLegalMoves(fromFen(fen)).length
    },
    bestMove(fen, depth = 3) {
      const mv = AIEngine.FindBestMove(fromFen(fen), depth)
      if (!mv) return { move: null, score: 0 }
      return { move: moveToUci(mv), score: 0 }
    },
  }
  return registerNative(ctx, { id, language: 'JavaScript', api })
}
