// =============================================================================
// main.ts — TypeScript 国际象棋入口（对齐 C++ main.cpp）
// -----------------------------------------------------------------------------
// 运行方式（零第三方运行时依赖，Node 22+ 原生支持 TypeScript）：
//   无需安装 tsx / ts-node，直接用 Node 22 的 transform-types 运行：
//     node --experimental-transform-types main.ts            # 默认运行 97 项自测
//     node --experimental-transform-types main.ts test       # 运行 97 项自测
//     node --experimental-transform-types main.ts selfplay 8 2   # AI(白) vs AI(黑) 各走 N=8 步，深度 D=2（默认 8,2）
//     node --experimental-transform-types main.ts bench 3    # 从初始局面做 FindBestMove 计时（深度 D=3 默认）
//     node --experimental-transform-types main.ts play       # 文本交互对弈（人类执白）
//     node --experimental-transform-types main.ts play ai    # 文本交互对弈（人类执白，AI 执黑，默认深度 2）
//   （备选：若已装 tsx，也可 npx tsx main.ts ...）
//
// 子命令：
//   test            运行全部自测，打印 [PASS]/[FAIL]，退出码=失败数（0=全绿）
//   selfplay N D    AI(白)vs AI(黑) 各走 N 步，深度 D；默认 N=8,D=2
//   bench D         初始局面 FindBestMove 计时；默认 D=3
//   play [ai]       文本交互对弈；"e2e4"式输入；升变默认选后；new 重开，quit 退出；
//                   play ai = 人类执白、AI(黑) 接手（默认深度 2）
//   无参数默认 = test
//
// 棋盘坐标：board[row][col]，row 0=第8横线（屏幕上方），col 0..7 = a..h；移动输入如 e2e4。
// =============================================================================

import * as readline from 'readline';
import { GameState, Move, Rules, SpecialMove } from './chessCore.ts';
import { AIEngine } from './chessAI.ts';
import { runTests } from './tests.ts';

// 渲染棋盘（字母简记 + 坐标），供文本界面与自对弈演示
function PrintBoard(s: GameState): void {
    let out = "  +------------------------+\n";
    for (let r = 0; r < 8; ++r) {
        out += (8 - r) + " | ";
        for (let c = 0; c < 8; ++c) {
            const p = s.board[r][c];
            out += (p === '.' ? '.' : p) + ' ';
        }
        out += "|\n";
    }
    out += "  +------------------------+\n";
    out += "    a b c d e f g h\n";
    process.stdout.write(out);
}

// 解析 "e2e4" 形式的坐标串（返回是否成功 + from/to）
function ParseSquare(sq: string): [boolean, number, number] {
    if (sq.length !== 2) return [false, 0, 0];
    if (sq[0] < 'a' || sq[0] > 'h') return [false, 0, 0];
    if (sq[1] < '1' || sq[1] > '8') return [false, 0, 0];
    const col = sq[0].charCodeAt(0) - 'a'.charCodeAt(0);
    const row = 8 - (sq[1].charCodeAt(0) - '0'.charCodeAt(0));
    return [true, row, col];
}

function cmd_tests(): number {
    const fails = runTests();
    return fails === 0 ? 0 : 1;
}

function cmd_selfplay(nmoves: number, depth: number): number {
    const s = new GameState();
    console.log("=== AI vs AI 自对弈（深度 " + depth + "，各 " + nmoves + " 步） ===");
    for (let i = 0; i < nmoves; ++i) {
        const all = Rules.GenerateAllLegalMoves(s);
        if (all.length === 0) {
            console.log("对局结束：");
            if (Rules.IsInCheck(s, s.whiteToMove)) console.log(s.whiteToMove ? "黑方将死白方" : "白方将死黑方");
            else console.log("逼和/和棋");
            PrintBoard(s);
            return 0;
        }
        const best = AIEngine.FindBestMove(s, depth);
        if (!best) { console.log("无最佳走法（异常）"); return 1; }
        Rules.ApplyMove(s, best);
        console.log((s.whiteToMove ? "黑" : "白") + ": " + best.toString());
    }
    PrintBoard(s);
    console.log("半步计数: " + s.halfmoveClock + "  走子历史条数: " + s.history.length);
    return 0;
}

function cmd_bench(depth: number): number {
    const s = new GameState();
    const t0 = Date.now();
    const best = AIEngine.FindBestMove(s, depth);
    const t1 = Date.now();
    const ms = t1 - t0;
    if (best)
        console.log("深度 " + depth + " 建议走法: " + best.toString() + "  (" + ms + " ms)");
    else
        console.log("无走法");
    return 0;
}

// 交互对弈
async function cmd_play(vsAI: boolean): Promise<number> {
    const s = new GameState();
    const depth = 2;
    console.log("文本国际象棋。输入走法如 e2e4；升变自动选后；输入 new 重开，quit 退出。");
    PrintBoard(s);

    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const question = (prompt: string): Promise<string> =>
        new Promise(res => rl.question(prompt, res));

    let exitCode = 0;
    while (true) {
        // 终局检测
        if (Rules.GenerateAllLegalMoves(s).length === 0) {
            console.log("对局结束：");
            if (Rules.IsInCheck(s, s.whiteToMove)) console.log(s.whiteToMove ? "黑方将死白方" : "白方将死黑方");
            else console.log("逼和/和棋");
            break;
        }
        const aiTurn = vsAI && (!s.whiteToMove); // 人类执白，AI 执黑
        if (aiTurn) {
            const best = AIEngine.FindBestMove(s, depth);
            if (!best) { console.log("AI 无走法"); break; }
            Rules.ApplyMove(s, best);
            console.log("AI(黑): " + best.toString());
            PrintBoard(s);
            continue;
        }

        const line = (await question(s.whiteToMove ? "白方走子> " : "黑方走子> ")).trim();
        if (line === "quit" || line === "exit") break;
        if (line === "new") { s.ResetToStartPosition(); PrintBoard(s); continue; }

        // 解析 from to
        let from = "", to = "";
        if (line.length >= 4) { from = line.substring(0, 2); to = line.substring(2, 4); }
        else { console.log("格式错误（示例 e2e4）"); continue; }

        const [ok1, fr, fc] = ParseSquare(from);
        const [ok2, tr, tc] = ParseSquare(to);
        if (!ok1 || !ok2) { console.log("坐标非法"); continue; }

        // 查找匹配走法（升变默认选后）
        let chosen: Move | null = null;
        for (const m of Rules.GenerateLegalMoves(s, fr, fc)) {
            if (m.toRow === tr && m.toCol === tc) {
                if (m.special === SpecialMove.Promotion && m.promotion !== 'Q') continue;
                chosen = m;
            }
        }
        if (!chosen) { console.log("非法走法"); continue; }
        Rules.ApplyMove(s, chosen);
        PrintBoard(s);
        if (Rules.IsInCheck(s, s.whiteToMove))
            console.log("将军！");
    }
    rl.close();
    return exitCode;
}

async function main(): Promise<number> {
    const argv = process.argv.slice(2);
    if (argv.length >= 1) {
        const cmd = argv[0];
        if (cmd === "test") return cmd_tests();
        if (cmd === "selfplay") {
            const n = argv.length >= 2 ? parseInt(argv[1], 10) : 8;
            const d = argv.length >= 3 ? parseInt(argv[2], 10) : 2;
            return cmd_selfplay(n, d);
        }
        if (cmd === "bench") {
            const d = argv.length >= 2 ? parseInt(argv[1], 10) : 3;
            return cmd_bench(d);
        }
        if (cmd === "play") {
            const ai = argv.length >= 2 && argv[1] === "ai";
            return await cmd_play(ai);
        }
        console.log("未知子命令: " + cmd);
        console.log("可用: test | selfplay [N] [D] | bench [D] | play [ai]");
        return 1;
    }
    // 默认运行自测
    return cmd_tests();
}

main().then(code => process.exit(code));
