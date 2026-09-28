// =============================================================================
// Program.fs — F# 国际象棋入口（对齐 C++ main.cpp / C# Program.cs）
// -----------------------------------------------------------------------------
// 子命令（port_spec 规范）：
//   dotnet run           运行 perft 自校验（默认）
//   dotnet run test      运行 perft 自校验
//   dotnet run selfplay N D  AI(白) vs AI(黑) 各走 N 步，搜索深度 D（默认 N=8 D=2）
//   dotnet run bench D    从初始局面做 FindBestMove 计时（默认 D=3）
//   dotnet run play [ai]  文本交互对弈；加 ai 则人类执白、AI(黑) 接手
//
// 零第三方依赖，仅用 .NET 标准库。引擎核心（ChessCore.fs）与 Cordis 无关，
// 此处仅为独立端口规范要求的控制台入口；JSON-stdio 驱动由 chess-cordis 承载。
// =============================================================================

module Program

open System
open ChessCore

let files = "abcdefgh"

let moveToUci (m: Move) =
    let s = sprintf "%c%d%c%d" files.[m.FromCol] (8 - m.FromRow) files.[m.ToCol] (8 - m.ToRow)
    if m.Promotion <> '.' then s + (Char.ToLowerInvariant(m.Promotion).ToString()) else s

let parseSquare (sq: string) =
    if sq.Length <> 2 then None
    elif sq.[0] < 'a' || sq.[0] > 'h' then None
    elif sq.[1] < '1' || sq.[1] > '8' then None
    else Some (8 - int (sq.[1] - '0'), int (sq.[0] - 'a'))

let printBoard (s: GameState) =
    printfn "  +------------------------+"
    for r in 0..7 do
        printf "%d | " (8 - r)
        for c in 0..7 do
            let p = s.Board.[r, c]
            printf "%c " (if p = '.' then '.' else p)
        printfn "|"
    printfn "  +------------------------+"
    printfn "    a b c d e f g h"

let newGame () =
    let s = GameState()
    s.ResetToStartPosition()
    s

// perft 自校验：验证走法生成与 C++ 黄金值一致（Start d3=8902 / Kiwipete d2=2039）。
let perftSanity () =
    let start = newGame ()
    let kiwi = fromFen "r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1"
    let a = perft start 3
    let b = perft kiwi 2
    let ok = a = 8902L && b = 2039L
    printfn "perft(Start,3)=%d (exp 8902)  perft(Kiwipete,2)=%d (exp 2039)" a b
    ok

let cmdSelfplay (nmoves: int) (depth: int) =
    let s = newGame ()
    printfn "=== AI vs AI 自对弈（深度 %d，各 %d 步） ===" depth nmoves
    for i in 1..nmoves do
        let moves = generateAllLegalMoves s
        if Seq.isEmpty moves then
            printfn "对局结束"
            printBoard s
        else
            let best = findBestMove s depth
            applyMove s best false
            printfn "%s: %s" (if s.WhiteToMove then "白" else "黑") (moveToUci best)
    printBoard s
    0

let cmdBench (depth: int) =
    let s = newGame ()
    let t0 = DateTime.Now
    let best = findBestMove s depth
    let ms = (DateTime.Now - t0).TotalMilliseconds
    if box best <> null then
        printfn "深度 %d 建议走法: %s  (%.0f ms)" depth (moveToUci best) ms
    else
        printfn "无走法"
    0

let cmdPlay (vsAI: bool) =
    let s = newGame ()
    let depth = 2
    printfn "文本国际象棋。输入走法如 e2e4；升变自动选后；输入 new 重开，quit 退出。"
    printBoard s
    let reader = Console.In
    let mutable running = true
    while running do
        let moves = generateAllLegalMoves s
        if Seq.isEmpty moves then
            printfn "对局结束"
            running <- false
        else
            let aiTurn = vsAI && not s.WhiteToMove
            if aiTurn then
                let best = findBestMove s depth
                applyMove s best false
                printfn "AI(黑): %s" (moveToUci best)
                printBoard s
            else
                printf "%s走子> " (if s.WhiteToMove then "白方" else "黑方")
                let line = reader.ReadLine()
                if isNull line then running <- false
                else
                    let line = line.Trim()
                    if line = "quit" || line = "exit" then running <- false
                    elif line = "new" then
                        s.ResetToStartPosition()
                        printBoard s
                    elif line.Length >= 4 then
                        match parseSquare (line.Substring(0, 2)), parseSquare (line.Substring(2, 2)) with
                        | Some(fr, fc), Some(tr, tc) ->
                            let chosen =
                                moves
                                |> Seq.tryFind (fun m ->
                                    m.FromRow = fr && m.FromCol = fc && m.ToRow = tr && m.ToCol = tc
                                    && not (m.Special = SpecialMove.Promotion && m.Promotion <> 'Q'))
                            match chosen with
                            | Some m -> applyMove s m false; printBoard s
                            | None -> printfn "非法走法"
                        | _ -> printfn "坐标非法"
                    else
                        printfn "格式错误（示例 e2e4）"
    0

[<EntryPoint>]
let main argv =
    if argv.Length >= 1 then
        match argv.[0] with
        | "test" ->
            let ok = perftSanity ()
            printfn "%s" (if ok then "TESTS PASSED" else "TESTS FAILED")
            if ok then 0 else 1
        | "selfplay" ->
            let n = if argv.Length >= 2 then Int32.Parse(argv.[1]) else 8
            let d = if argv.Length >= 3 then Int32.Parse(argv.[2]) else 2
            cmdSelfplay n d
        | "bench" ->
            let d = if argv.Length >= 2 then Int32.Parse(argv.[1]) else 3
            cmdBench d
        | "play" ->
            let ai = argv.Length >= 2 && argv.[1] = "ai"
            cmdPlay ai
        | other ->
            printfn "未知子命令: %s" other
            printfn "可用: test | selfplay [N] [D] | bench [D] | play [ai]"
            1
    else
        let ok = perftSanity ()
        printfn "%s" (if ok then "TESTS PASSED" else "TESTS FAILED")
        if ok then 0 else 1
