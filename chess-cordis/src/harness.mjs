// ChessHarness: drives the cross-engine perft validation once all engines are
// registered. It runs a curated set of standard perft positions at depths whose
// golden node counts are language-independent ground truth. If every engine
// agrees on the golden value, the 8-language fleet is proven move-generation
// equivalent under one Cordis architecture.
//
// This plugin injects `chessRegistry` (so it only runs once engines can exist)
// and provides `ctx.chessHarness.run()`, which emits `chess/divergence` events
// whenever any engine disagrees with the consensus / the known golden value.

import { Service } from 'cordis';
import { chessRegistry } from './registry.mjs';

// Standard perft positions + their known golden node counts.
// (Positions 1-4 from the perft literature; none involve en-passant.)
export const GOLDEN_POSITIONS = [
  {
    name: 'Start',
    fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
    depth: 3, expected: 8902,
  },
  {
    name: 'Start',
    fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
    depth: 4, expected: 197281,
  },
  {
    name: 'Kiwipete',
    fen: 'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1',
    depth: 2, expected: 2039,
  },
  {
    name: 'Kiwipete',
    fen: 'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1',
    depth: 3, expected: 97862,
  },
  {
    name: 'Wiki3',
    fen: '8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1',
    depth: 3, expected: 2812,
  },
  {
    name: 'Wiki3',
    fen: '8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1',
    depth: 4, expected: 43238,
  },
  {
    name: 'Wiki5',
    fen: 'rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 0 1',
    depth: 3, expected: 62379,
  },
];

// Positions for the cross-engine bestMove consensus check.
//  * expectConsensus: true  -> the best move is eval-invariant (a free capture of
//    a hanging piece), so every material-greedy engine MUST agree. Any divergence
//    is a real bug. This is the genuine cross-engine consensus assertion.
//  * expectConsensus: false -> general positions where eval differences legitimately
//    produce different "best" moves; reported as informational only.
// Default search depth for the bestMove consensus sweep (overridable per
// position). Depth 2 negamax + quiescence is enough to prove the eval-invariant
// captures below; the dense positions (Start/Kiwipete) stay informational/fast.
export const BESTMOVE_DEPTH = 2;
export const BESTMOVE_POSITIONS = [
  {
    name: 'FreeQueen',
    fen: '4k3/8/8/3q4/8/8/8/3RK3 w - - 0 1',
    expectedMove: 'd1d5',
    expectConsensus: true,
    depth: 3,
  },
  {
    name: 'FreeRook',
    fen: '4k3/8/8/8/3r4/8/8/3RK3 w - - 0 1',
    expectedMove: 'd1d4',
    expectConsensus: true,
    depth: 3,
  },
  {
    name: 'Start',
    fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
    expectConsensus: false,
    depth: 2,
  },
  {
    name: 'Kiwipete',
    fen: 'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1',
    expectConsensus: false,
    depth: 2,
  },
];

export class ChessHarness extends Service {
  constructor(ctx) {
    super(ctx, 'chessHarness');
    this.lastBestMoveReport = null;
  }

  async run(positions = GOLDEN_POSITIONS) {
    const report = [];
    for (const pos of positions) {
      const results = await chessRegistry.runPerft(pos.fen, pos.depth);
      const { consensus, diverged } = chessRegistry.analyzeDivergence(results);
      const match = consensus === pos.expected;
      const entry = {
        name: pos.name,
        depth: pos.depth,
        expected: pos.expected,
        consensus,
        match,
        diverged,
        results,
      };
      if (diverged.length || !match) {
        this.ctx.emit('chess/divergence', entry);
      }
      report.push(entry);
    }
    return report;
  }

  // Human-readable summary for the console.
  formatReport(report) {
    const lines = [];
    lines.push('=== Cordis ChessHarness: cross-engine perft ===');
    lines.push(`engines loaded: ${chessRegistry.list().length}`);
    let allPass = true;
    for (const e of report) {
      const status = e.match && e.diverged.length === 0 ? 'PASS' : 'FAIL';
      if (status === 'FAIL') allPass = false;
      const vals = e.results.map((r) => `${r.id}=${r.ok ? r.nodes : 'ERR' + (r.error ? '(' + r.error + ')' : '')}`).join('  ');
      lines.push(`[${status}] ${e.name} d${e.depth}  expected=${e.expected}  consensus=${e.consensus}  ${vals}`);
      if (e.diverged.length) lines.push(`        diverged: ${e.diverged.join(', ')}`);
    }
    lines.push(allPass ? 'OVERALL: ALL ENGINES AGREE ON GOLDEN VALUES' : 'OVERALL: DIVERGENCE DETECTED');
    return lines.join('\n');
  }

  // Cross-engine bestMove consensus sweep. For each position it asks every
  // engine that implements bestMove() for its preferred move (normalized to UCI
  // by each engine), then computes the consensus (most common UCI move) across
  // the SUPPORTED engines. Positions flagged `expectConsensus: true` are eval-
  // invariant free captures of a hanging piece, so every material-aware engine
  // MUST agree on the expected move — any divergence there is a genuine bug.
  // Other positions are reported as INFO only (eval differences legitimately
  // produce different "best" moves between engines).
  async runBestMove(positions = BESTMOVE_POSITIONS) {
    const report = [];
    for (const pos of positions) {
      const depth = pos.depth ?? BESTMOVE_DEPTH;
      const results = await chessRegistry.runBestMove(pos.fen, depth);

      // Only engines that successfully returned a move participate in consensus.
      const played = results.filter((r) => r.ok && r.move != null);
      const counts = new Map();
      for (const r of played) counts.set(r.move, (counts.get(r.move) || 0) + 1);
      let consensus = null, bestN = -1;
      for (const [mv, n] of counts) {
        if (n > bestN) { bestN = n; consensus = mv; }
      }

      const diverged = played.filter((r) => r.move !== consensus).map((r) => r.id);
      const unsupported = results.filter((r) => r.unsupported).map((r) => r.id);
      const errored = results.filter((r) => !r.ok && !r.unsupported).map((r) => r.id);

      let failed = false;
      if (pos.expectConsensus) {
        // Every supported engine must agree with each other AND with the known
        // best move. Errors also break the consensus assertion.
        failed = consensus !== pos.expectedMove || diverged.length > 0 || errored.length > 0;
      }
      const status = pos.expectConsensus ? (failed ? 'FAIL' : 'PASS') : 'INFO';

      const entry = {
        name: pos.name,
        fen: pos.fen,
        depth,
        expectedMove: pos.expectedMove ?? null,
        expectConsensus: pos.expectConsensus,
        consensus,
        diverged,
        unsupported,
        errored,
        failed,
        status,
        results,
      };
      if (failed) this.ctx.emit('chess/bestmove-divergence', entry);
      report.push(entry);
    }
    this.lastBestMoveReport = report;
    return report;
  }

  // Human-readable summary of the bestMove consensus sweep.
  formatBestMoveReport() {
    const report = this.lastBestMoveReport;
    if (!report) return '(bestMove consensus not run)';
    const lines = [];
    lines.push('=== Cordis ChessHarness: cross-engine bestMove consensus ===');
    let anyFail = false;
    for (const e of report) {
      if (e.failed) anyFail = true;
      const moves = e.results.map((r) => {
        const mv = r.unsupported ? 'n/a' : (r.ok ? r.move : 'ERR');
        return `${r.id}=${mv}`;
      }).join('  ');
      lines.push(`[${e.status}] ${e.name}  depth=${e.depth}  consensus=${e.consensus ?? '-'}  expected=${e.expectedMove ?? '-'}  ${moves}`);
      if (e.diverged.length) lines.push(`        diverged: ${e.diverged.join(', ')}`);
      if (e.errored.length) lines.push(`        errored:  ${e.errored.join(', ')}`);
      if (e.unsupported.length) lines.push(`        unsupported: ${e.unsupported.join(', ')}`);
    }
    lines.push(anyFail ? 'OVERALL: BESTMOVE CONSENSUS BROKEN' : 'OVERALL: BESTMOVE CONSENSUS OK');
    return lines.join('\n');
  }
}

// Plugin loader for the harness service.
export const harnessPlugin = {
  name: 'chess-harness',
  apply(ctx) {
    new ChessHarness(ctx);
  },
};
