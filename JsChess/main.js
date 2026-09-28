// =============================================================================
// main.js — JavaScript 国际象棋入口（Node.js ES Module）
// -----------------------------------------------------------------------------
// 用法（Node.js ≥ 14，目录含 package.json {"type":"module"}）：
//
//   node main.js               运行 97 项自测（默认）
//   node main.js test         运行 97 项自测
//   node main.js selfplay N D AI(白) vs AI(黑) 各走 N 步，搜索深度 D（默认 N=8,D=2）
//   node main.js bench D      从初始局面做 FindBestMove 计时（默认 D=3）
//   node main.js play [ai]    文本交互对弈；加 ai 则人类执白、AI(黑) 接手（默认深度2）
//                             走法输入如 e2e4；升变自动选后；输入 new 重开，quit 退出
//
// 退出码：test 命令下 = 失败测试数（0 = 全绿）；其它命令 = 0。
// =============================================================================

import { GameState, Rules, Move, SpecialMove } from './chessCore.js';
import { AIEngine } from './chessAI.js';
import { runTests } from './tests.js';
import * as readline from 'readline';

// 渲染棋盘（字母简记 + 坐标）
function PrintBoard(s) {
    let out = '  +------------------------+\n';
    for (let r = 0; r < 8; r++) {
        out += (8 - r) + ' | ';
        for (let c = 0; c < 8; c++) {
            const p = s.board[r][c];
            out += (p === '.') ? '. ' : (p + ' ');
        }
        out += '|\n';
    }
    out += '  +------------------------+\n';
    out += '    a b c d e f g h\n';
    process.stdout.write(out);
}

// 解析 "e2e4" 形式的坐标串（返回是否成功 + from/to）
function ParseSquare(sq) {
    if (sq.length !== 2) return null;
    if (sq[0] < 'a' || sq[0] > 'h') return null;
    if (sq[1] < '1' || sq[1] > '8') return null;
    const col = sq[0].charCodeAt(0) - 'a'.charCodeAt(0);
    const row = 8 - (sq[1].charCodeAt(0) - '0'.charCodeAt(0));
    return { row, col };
}

function cmd_tests() {
    const fails = runTests();
    return fails === 0 ? 0 : 1;
}

function cmd_selfplay(nmoves, depth) {
    const s = new GameState();
    console.log('=== AI vs AI 自对弈（深度 ' + depth + '，各 ' + nmoves + ' 步） ===');
    for (let i = 0; i < nmoves; i++) {
        const all = Rules.GenerateAllLegalMoves(s);
        if (all.length === 0) {
            process.stdout.write('对局结束：');
            if (Rules.IsInCheck(s, s.whiteToMove)) process.stdout.write(s.whiteToMove ? '黑方将死白方' : '白方将死黑方');
            else process.stdout.write('逼和/和棋');
            process.stdout.write('\n');
            PrintBoard(s);
            return 0;
        }
        const best = AIEngine.FindBestMove(s, depth);
        if (!best) { console.log('无最佳走法（异常）'); return 1; }
        Rules.ApplyMove(s, best);
        console.log((s.whiteToMove ? '黑' : '白') + ': ' + best.toString());
    }
    PrintBoard(s);
    console.log('半步计数: ' + s.halfmoveClock + '  走子历史条数: ' + s.history.length);
    return 0;
}

function cmd_bench(depth) {
    const s = new GameState();
    const t0 = Date.now();
    const best = AIEngine.FindBestMove(s, depth);
    const t1 = Date.now();
    const ms = t1 - t0;
    if (best)
        console.log('深度 ' + depth + ' 建议走法: ' + best.toString() + '  (' + ms + ' ms)');
    else
        console.log('无走法');
    return 0;
}

// 交互对弈
async function cmd_play(vsAI) {
    const s = new GameState();
    const depth = 2;
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const ask = (q) => new Promise((res) => rl.question(q, res));

    console.log('文本国际象棋。输入走法如 e2e4；升变自动选后；输入 new 重开，quit 退出。');
    PrintBoard(s);
    let exitCode = 0;
    while (true) {
        // 终局检测
        if (Rules.GenerateAllLegalMoves(s).length === 0) {
            process.stdout.write('对局结束：');
            if (Rules.IsInCheck(s, s.whiteToMove)) process.stdout.write(s.whiteToMove ? '黑方将死白方' : '白方将死黑方');
            else process.stdout.write('逼和/和棋');
            process.stdout.write('\n');
            break;
        }
        const aiTurn = vsAI && (!s.whiteToMove); // 人类执白，AI 执黑
        if (aiTurn) {
            const best = AIEngine.FindBestMove(s, depth);
            if (!best) { console.log('AI 无走法'); break; }
            Rules.ApplyMove(s, best);
            console.log('AI(黑): ' + best.toString());
            PrintBoard(s);
            continue;
        }

        const line = (await ask((s.whiteToMove ? '白方' : '黑方') + '走子> ')).trim();
        if (line === 'quit' || line === 'exit') { exitCode = 0; break; }
        if (line === 'new') { s.ResetToStartPosition(); PrintBoard(s); continue; }

        // 解析 from to
        let from = null, to = null;
        if (line.length >= 4) { from = line.substring(0, 2); to = line.substring(2, 4); }
        if (!from || !to) { console.log('格式错误（示例 e2e4）'); continue; }

        const fp = ParseSquare(from), tp = ParseSquare(to);
        if (!fp || !tp) { console.log('坐标非法'); continue; }

        // 查找匹配走法（升变默认选后）
        let chosen = null;
        for (const m of Rules.GenerateLegalMoves(s, fp.row, fp.col)) {
            if (m.toRow === tp.row && m.toCol === tp.col) {
                if (m.special === SpecialMove.Promotion && m.promotion !== 'Q') continue;
                chosen = m;
            }
        }
        if (!chosen) { console.log('非法走法'); continue; }
        Rules.ApplyMove(s, chosen);
        PrintBoard(s);
        if (Rules.IsInCheck(s, s.whiteToMove))
            console.log('将军！');
    }
    rl.close();
    return exitCode;
}

async function main() {
    const argv = process.argv.slice(2);
    if (argv.length >= 1) {
        const cmd = argv[0];
        if (cmd === 'test') return cmd_tests();
        if (cmd === 'selfplay') {
            const n = argv.length >= 2 ? parseInt(argv[1], 10) : 8;
            const d = argv.length >= 3 ? parseInt(argv[2], 10) : 2;
            return cmd_selfplay(n, d);
        }
        if (cmd === 'bench') {
            const d = argv.length >= 2 ? parseInt(argv[1], 10) : 3;
            return cmd_bench(d);
        }
        if (cmd === 'play') {
            const ai = argv.length >= 2 && argv[1] === 'ai';
            return await cmd_play(ai);
        }
        console.log('未知子命令: ' + cmd);
        console.log('可用: test | selfplay [N] [D] | bench [D] | play [ai]');
        return 1;
    }
    // 默认运行自测
    return cmd_tests();
}

main().then((code) => { process.exit(code); });
