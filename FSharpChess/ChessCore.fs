// =============================================================================
// ChessCore.fs — F# 国际象棋核心引擎
// -----------------------------------------------------------------------------
// 逐条对齐 C# 内核 (CSharpChess/chessCore.cs)，保证 perft 黄金值与跨语言一致。
// 棋盘：Board[row, col]，row 0 = 第 8 横线（黑方底线），row 7 = 第 1 横线（白方底线）。
// 大写 = 白方，小写 = 黑方，'.' = 空格。
// 合法走法 = 伪合法走法 - 会使己方王被攻击的走法（IsAttacked 单一例程支撑）。
// =============================================================================

module ChessCore

open System
open System.Collections.Generic
open System.Text

// ---------------------------- 特殊走法类型 ----------------------------
type SpecialMove =
    | None = 0
    | DoublePawn = 1      // 兵双重进兵（设置过路兵目标格）
    | EnPassant = 2       // 吃过路兵
    | CastleKingside = 3  // 短易位
    | CastleQueenside = 4 // 长易位
    | Promotion = 5       // 兵升变

// ---------------------------- 走法 ----------------------------
type Move = {
    FromRow: int
    FromCol: int
    ToRow: int
    ToCol: int
    Piece: char     // 走动的棋子
    Captured: char  // 被吃的棋子（'.' = 未吃子）
    Special: SpecialMove
    Promotion: char // 升变目标棋子
}

// ---------------------------- 对局状态 ----------------------------
type GameState() =
    member val Board: char[,] = Array2D.create 8 8 '.' with get, set
    member val WhiteToMove: bool = true with get, set
    member val CanCastleWK: bool = true with get, set
    member val CanCastleWQ: bool = true with get, set
    member val CanCastleBK: bool = true with get, set
    member val CanCastleBQ: bool = true with get, set
    member val EnPassantRow: int = -1 with get, set
    member val EnPassantCol: int = -1 with get, set
    member val HalfmoveClock: int = 0 with get, set
    member val FullmoveNumber: int = 1 with get, set
    // RepHistory: runner-supplied engine.mjs position keys seen so far this game
    // (excludes the current position). Used by the repetition penalty in evaluate.
    // None ⇒ no penalty. Shared read-only reference in CloneLight (never deep-copied;
    // the search never mutates it).
    member val RepHistory: Map<string,int> option = None with get, set

    // engine.mjs-compatible position key: 64 board chars (row-major) + side ('w'/'b')
    // + concatenated present castling rights (NO dash/separator) + en-passant using the
    // STORED square (EnPassantRow/EnPassantCol) or "-1,-1". Must byte-match
    // engine.mjs getPositionKey exactly, otherwise the penalty never fires.
    member this.PositionKeySimple() =
        let sb = StringBuilder(80)
        for r in 0..7 do
            for c in 0..7 do
                sb.Append(this.Board.[r, c]) |> ignore
        sb.Append(if this.WhiteToMove then 'w' else 'b') |> ignore
        if this.CanCastleWK then sb.Append('K') |> ignore
        if this.CanCastleWQ then sb.Append('Q') |> ignore
        if this.CanCastleBK then sb.Append('k') |> ignore
        if this.CanCastleBQ then sb.Append('q') |> ignore
        if this.EnPassantRow >= 0 && this.EnPassantCol >= 0 then
            sb.Append(this.EnPassantRow).Append(',').Append(this.EnPassantCol) |> ignore
        else
            sb.Append("-1,-1") |> ignore
        sb.ToString()

    member this.ResetToStartPosition() =
        let back = "rnbqkbnr"
        for c in 0..7 do
            this.Board.[0, c] <- back.[c]
            this.Board.[1, c] <- 'p'
            this.Board.[2, c] <- '.'
            this.Board.[3, c] <- '.'
            this.Board.[4, c] <- '.'
            this.Board.[5, c] <- '.'
            this.Board.[6, c] <- 'P'
            this.Board.[7, c] <- Char.ToUpperInvariant(back.[c])
        this.WhiteToMove <- true
        this.CanCastleWK <- true
        this.CanCastleWQ <- true
        this.CanCastleBK <- true
        this.CanCastleBQ <- true
        this.EnPassantRow <- -1
        this.EnPassantCol <- -1
        this.HalfmoveClock <- 0
        this.FullmoveNumber <- 1

    member this.CloneLight() =
        let s = GameState()
        s.Board <- Array2D.copy this.Board
        s.WhiteToMove <- this.WhiteToMove
        s.CanCastleWK <- this.CanCastleWK
        s.CanCastleWQ <- this.CanCastleWQ
        s.CanCastleBK <- this.CanCastleBK
        s.CanCastleBQ <- this.CanCastleBQ
        s.EnPassantRow <- this.EnPassantRow
        s.EnPassantCol <- this.EnPassantCol
        s.HalfmoveClock <- this.HalfmoveClock
        s.FullmoveNumber <- this.FullmoveNumber
        s.RepHistory <- this.RepHistory // shared read-only during search
        s

// ---------------------------- 规则引擎 ----------------------------
let inline inBoard r c = r >= 0 && r <= 7 && c >= 0 && c <= 7
let isWhitePiece (p: char) = p <> '.' && Char.IsUpper(p)
let isBlackPiece (p: char) = p <> '.' && Char.IsLower(p)
let isPieceOfSide (p: char) (white: bool) =
    if p = '.' then false
    elif white then Char.IsUpper(p)
    else Char.IsLower(p)

let knightDR = [|-2;-2;-1;-1;1;1;2;2|]
let knightDC = [|-1;1;-2;2;-2;2;-1;1|]
let kingDR = [|-1;-1;-1;0;0;1;1;1|]
let kingDC = [|-1;0;1;-1;1;-1;0;1|]
let bishopDR = [|-1;-1;1;1|]
let bishopDC = [|-1;1;-1;1|]
let rookDR = [|-1;1;0;0|]
let rookDC = [|0;0;-1;1|]
let queenDR = [|-1;1;0;0;-1;-1;1;1|]
let queenDC = [|0;0;-1;1;-1;1;-1;1|]
let rayDR = [|-1;1;0;0;-1;-1;1;1|]
let rayDC = [|0;0;-1;1;-1;1;-1;1|]

// 单一例程支撑整个规则库：square (r,c) 是否被 byWhite 方攻击
let isAttacked (board: char[,]) r c byWhite =
    let mutable res = false
    let pawn = if byWhite then 'P' else 'p'
    let pr = if byWhite then r + 1 else r - 1
    if pr >= 0 && pr <= 7 then
        if c - 1 >= 0 && board.[pr, c-1] = pawn then res <- true
        if c + 1 <= 7 && board.[pr, c+1] = pawn then res <- true
    let knight = if byWhite then 'N' else 'n'
    for i in 0..7 do
        let tr = r + knightDR.[i]
        let tc = c + knightDC.[i]
        if inBoard tr tc && board.[tr, tc] = knight then res <- true
    let king = if byWhite then 'K' else 'k'
    for dr in -1..1 do
        for dc in -1..1 do
            if not (dr = 0 && dc = 0) then
                let tr = r + dr
                let tc = c + dc
                if inBoard tr tc && board.[tr, tc] = king then res <- true
    let rook = if byWhite then 'R' else 'r'
    let queen = if byWhite then 'Q' else 'q'
    let bishop = if byWhite then 'B' else 'b'
    for i in 0..7 do
        let mutable tr = r + rayDR.[i]
        let mutable tc = c + rayDC.[i]
        while inBoard tr tc && not res do
            let p = board.[tr, tc]
            if p <> '.' then
                if i < 4 then
                    if p = rook || p = queen then res <- true
                else
                    if p = bishop || p = queen then res <- true
                tr <- 100; tc <- 100
            else
                tr <- tr + rayDR.[i]
                tc <- tc + rayDC.[i]
    res

// ---------------------------- 兵走法 ----------------------------
let pawnCaptureDC = [|-1; 1|]

let addPawnMove (list: ResizeArray<Move>) r c tr tc captured special isWhite =
    if tr = 0 || tr = 7 then
        let promos = "QRBN"
        for i in 0..3 do
            list.Add({ FromRow=r; FromCol=c; ToRow=tr; ToCol=tc;
                       Piece=(if isWhite then 'P' else 'p'); Captured=captured;
                       Special=SpecialMove.Promotion;
                       Promotion=(if isWhite then promos.[i] else Char.ToLowerInvariant(promos.[i])) })
    else
        list.Add({ FromRow=r; FromCol=c; ToRow=tr; ToCol=tc;
                   Piece=(if isWhite then 'P' else 'p'); Captured=captured;
                   Special=special; Promotion='.' })

let generatePawnMoves (list: ResizeArray<Move>) (state: GameState) r c isWhite enemyPawn =
    let b = state.Board
    let dir = if isWhite then -1 else 1
    let startRow = if isWhite then 6 else 1
    if inBoard (r + dir) c && b.[r + dir, c] = '.' then
        addPawnMove list r c (r + dir) c '.' SpecialMove.None isWhite
        if r = startRow && b.[r + 2*dir, c] = '.' then
            list.Add({ FromRow=r; FromCol=c; ToRow=r+2*dir; ToCol=c;
                       Piece=(if isWhite then 'P' else 'p'); Captured='.';
                       Special=SpecialMove.DoublePawn; Promotion='.' })
    for i in 0..1 do
        let dc = pawnCaptureDC.[i]
        let tr = r + dir
        let tc = c + dc
        if inBoard tr tc then
            let target = b.[tr, tc]
            if target <> '.' && isPieceOfSide target (not isWhite) then
                addPawnMove list r c tr tc target SpecialMove.None isWhite
            elif tr = state.EnPassantRow && tc = state.EnPassantCol then
                addPawnMove list r c tr tc enemyPawn SpecialMove.EnPassant isWhite

// ---------------------------- 马/王固定偏移 ----------------------------
let generateOffsetMoves (list: ResizeArray<Move>) (b: char[,]) r c isWhite (dr: int[]) (dc: int[]) n =
    let p = b.[r, c]
    for i in 0..n-1 do
        let tr = r + dr.[i]
        let tc = c + dc.[i]
        if inBoard tr tc then
            let target = b.[tr, tc]
            if target = '.' || isPieceOfSide target (not isWhite) then
                list.Add({ FromRow=r; FromCol=c; ToRow=tr; ToCol=tc;
                           Piece=p; Captured=target; Special=SpecialMove.None; Promotion='.' })

// ---------------------------- 象/车/后滑动 ----------------------------
let generateSlidingMoves (list: ResizeArray<Move>) (b: char[,]) r c isWhite (dr: int[]) (dc: int[]) n =
    let p = b.[r, c]
    for i in 0..n-1 do
        let mutable tr = r + dr.[i]
        let mutable tc = c + dc.[i]
        while inBoard tr tc do
            let target = b.[tr, tc]
            if target = '.' then
                list.Add({ FromRow=r; FromCol=c; ToRow=tr; ToCol=tc;
                           Piece=p; Captured='.'; Special=SpecialMove.None; Promotion='.' })
            else
                if isPieceOfSide target (not isWhite) then
                    list.Add({ FromRow=r; FromCol=c; ToRow=tr; ToCol=tc;
                               Piece=p; Captured=target; Special=SpecialMove.None; Promotion='.' })
                tr <- 100; tc <- 100
            if inBoard tr tc then
                tr <- tr + dr.[i]
                tc <- tc + dc.[i]

// ---------------------------- 王车易位 ----------------------------
let generateCastlingMoves (list: ResizeArray<Move>) (state: GameState) r c isWhite =
    let b = state.Board
    if isWhite then
        if r <> 7 || c <> 4 then ()
        else
            if state.CanCastleWK && b.[7,7] = 'R' && b.[7,5] = '.' && b.[7,6] = '.' then
                if not (isAttacked b 7 4 false) && not (isAttacked b 7 5 false) && not (isAttacked b 7 6 false) then
                    list.Add({ FromRow=7; FromCol=4; ToRow=7; ToCol=6; Piece='K';
                               Captured='.'; Special=SpecialMove.CastleKingside; Promotion='.' })
            if state.CanCastleWQ && b.[7,0] = 'R' && b.[7,1] = '.' && b.[7,2] = '.' && b.[7,3] = '.' then
                if not (isAttacked b 7 4 false) && not (isAttacked b 7 3 false) && not (isAttacked b 7 2 false) then
                    list.Add({ FromRow=7; FromCol=4; ToRow=7; ToCol=2; Piece='K';
                               Captured='.'; Special=SpecialMove.CastleQueenside; Promotion='.' })
    else
        if r <> 0 || c <> 4 then ()
        else
            if state.CanCastleBK && b.[0,7] = 'r' && b.[0,5] = '.' && b.[0,6] = '.' then
                if not (isAttacked b 0 4 true) && not (isAttacked b 0 5 true) && not (isAttacked b 0 6 true) then
                    list.Add({ FromRow=0; FromCol=4; ToRow=0; ToCol=6; Piece='k';
                               Captured='.'; Special=SpecialMove.CastleKingside; Promotion='.' })
            if state.CanCastleBQ && b.[0,0] = 'r' && b.[0,1] = '.' && b.[0,2] = '.' && b.[0,3] = '.' then
                if not (isAttacked b 0 4 true) && not (isAttacked b 0 3 true) && not (isAttacked b 0 2 true) then
                    list.Add({ FromRow=0; FromCol=4; ToRow=0; ToCol=2; Piece='k';
                               Captured='.'; Special=SpecialMove.CastleQueenside; Promotion='.' })

// ---------------------------- 伪合法走法生成 ----------------------------
let generatePseudoMoves (state: GameState) r c =
    let list = ResizeArray<Move>()
    let b = state.Board
    let p = b.[r, c]
    if p = '.' then list
    else
        let isWhite = Char.IsUpper(p)
        let enemyPawn = if isWhite then 'p' else 'P'
        match Char.ToUpperInvariant(p) with
        | 'P' -> generatePawnMoves list state r c isWhite enemyPawn
        | 'N' -> generateOffsetMoves list b r c isWhite knightDR knightDC 8
        | 'K' -> generateOffsetMoves list b r c isWhite kingDR kingDC 8
                 generateCastlingMoves list state r c isWhite
        | 'B' -> generateSlidingMoves list b r c isWhite bishopDR bishopDC 4
        | 'R' -> generateSlidingMoves list b r c isWhite rookDR rookDC 4
        | 'Q' -> generateSlidingMoves list b r c isWhite queenDR queenDC 8
        | _ -> ()
        list

// ---------------------------- 合法走法（两阶段） ----------------------------
let findKing (board: char[,]) isWhite =
    let k = if isWhite then 'K' else 'k'
    let mutable kr = -1
    let mutable kc = -1
    for i in 0..7 do
        for j in 0..7 do
            if board.[i, j] = k then kr <- i; kc <- j
    (kr, kc)

let rec generateLegalMoves (state: GameState) r c =
    let legal = ResizeArray<Move>()
    let pseudo = generatePseudoMoves state r c
    if pseudo.Count = 0 then legal
    else
        let moverIsWhite = Char.IsUpper(pseudo.[0].Piece)
        for m in pseudo do
            let sim = state.CloneLight()
            applyMove sim m false
            let (kr, kc) = findKing sim.Board moverIsWhite
            if not (isAttacked sim.Board kr kc (not moverIsWhite)) then
                legal.Add(m)
        legal

and generateAllLegalMoves (state: GameState) =
    let all = ResizeArray<Move>()
    for r in 0..7 do
        for c in 0..7 do
            if isPieceOfSide state.Board.[r, c] state.WhiteToMove then
                let legal = generateLegalMoves state r c
                all.AddRange(legal)
    all

// ---------------------------- 走子执行 ----------------------------
and applyMove (state: GameState) (m: Move) _recordHistory =
    let b = state.Board
    b.[m.ToRow, m.ToCol] <- m.Piece
    b.[m.FromRow, m.FromCol] <- '.'
    match m.Special with
    | SpecialMove.DoublePawn ->
        state.EnPassantRow <- (m.FromRow + m.ToRow) / 2
        state.EnPassantCol <- m.FromCol
    | SpecialMove.EnPassant ->
        let capRow = if m.Piece = 'P' then m.ToRow + 1 else m.ToRow - 1
        b.[capRow, m.ToCol] <- '.'
    | SpecialMove.CastleKingside ->
        b.[m.FromRow, 5] <- b.[m.FromRow, 7]
        b.[m.FromRow, 7] <- '.'
    | SpecialMove.CastleQueenside ->
        b.[m.FromRow, 3] <- b.[m.FromRow, 0]
        b.[m.FromRow, 0] <- '.'
    | SpecialMove.Promotion ->
        b.[m.ToRow, m.ToCol] <- m.Promotion
    | _ -> ()
    if m.Special <> SpecialMove.DoublePawn then
        state.EnPassantRow <- -1
        state.EnPassantCol <- -1
    if m.Piece = 'K' then
        state.CanCastleWK <- false
        state.CanCastleWQ <- false
    elif m.Piece = 'k' then
        state.CanCastleBK <- false
        state.CanCastleBQ <- false
    if (m.FromRow = 7 && m.FromCol = 0) || (m.ToRow = 7 && m.ToCol = 0) then state.CanCastleWQ <- false
    if (m.FromRow = 7 && m.FromCol = 7) || (m.ToRow = 7 && m.ToCol = 7) then state.CanCastleWK <- false
    if (m.FromRow = 0 && m.FromCol = 0) || (m.ToRow = 0 && m.ToCol = 0) then state.CanCastleBQ <- false
    if (m.FromRow = 0 && m.FromCol = 7) || (m.ToRow = 0 && m.ToCol = 7) then state.CanCastleBK <- false
    if Char.ToUpperInvariant(m.Piece) = 'P' || m.Captured <> '.' then
        state.HalfmoveClock <- 0
    else
        state.HalfmoveClock <- state.HalfmoveClock + 1
    if not state.WhiteToMove then state.FullmoveNumber <- state.FullmoveNumber + 1
    state.WhiteToMove <- not state.WhiteToMove

// ---------------------------- 将军检测 ----------------------------
let isInCheck (state: GameState) isWhite =
    let (kr, kc) = findKing state.Board isWhite
    if kr < 0 then false else isAttacked state.Board kr kc (not isWhite)

// ---------------------------- FEN 解析 ----------------------------
let fromFen (fen: string) =
    let gs = GameState()
    let parts = fen.Split(' ')
    let rows = parts.[0].Split('/')
    for r in 0..7 do
        let rowStr = rows.[r]
        let mutable c = 0
        for ch in rowStr do
            if ch >= '1' && ch <= '9' then c <- c + int(ch - '0')
            else
                gs.Board.[r, c] <- ch
                c <- c + 1
    gs.WhiteToMove <- (parts.[1] = "w")
    let castling = parts.[2]
    gs.CanCastleWK <- castling.Contains('K')
    gs.CanCastleWQ <- castling.Contains('Q')
    gs.CanCastleBK <- castling.Contains('k')
    gs.CanCastleBQ <- castling.Contains('q')
    let ep = parts.[3]
    if ep <> "-" && ep.Length = 2 then
        let col = int(ep.[0]) - int('a')
        let rank = int(ep.[1]) - int('0')
        gs.EnPassantRow <- 8 - rank
        gs.EnPassantCol <- col
    if parts.Length > 4 then gs.HalfmoveClock <- int(parts.[4])
    if parts.Length > 5 then gs.FullmoveNumber <- int(parts.[5])
    gs

// ---------------------------- perft ----------------------------
let rec perft (state: GameState) depth : int64 =
    if depth = 0 then 1L
    else
        let moves = generateAllLegalMoves state
        let mutable nodes = 0L
        for m in moves do
            let ns = state.CloneLight()
            applyMove ns m false
            nodes <- nodes + perft ns (depth - 1)
        nodes

// ---------------------------- AI：negamax + 子力 + 静止搜索 ----------------------------
// RepetitionPenalty：当叶局面的 engine.mjs 兼容键出现在 RepHistory（本局此前见过的
// 局面）中时，按出现次数扣分（白方视角）。引导搜索远离会把对局带回重复局面的走法，
// 从而减少三重复和棋。取值约半兵，足够影响平手选择、又不至于让引擎为避重而白白弃子。
let RepetitionPenalty = 60

let pieceValue (p: char) =
    match Char.ToUpperInvariant(p) with
    | 'P' -> 100
    | 'N' -> 320
    | 'B' -> 330
    | 'R' -> 500
    | 'Q' -> 900
    | 'K' -> 20000
    | _ -> 0

// Piece-square tables (Tomasz Michniewski, "Simplified Evaluation Function"),
// indexed [rank8..rank1] (row 0 = rank 8 = board row 0). White uses pst.[r, c];
// Black uses the vertically mirrored pst.[7 - r, c].
let private pawnPST = array2D [
    [   0;   0;   0;   0;   0;   0;   0;   0 ]
    [  50;  50;  50;  50;  50;  50;  50;  50 ]
    [  10;  10;  20;  30;  30;  20;  10;  10 ]
    [   5;   5;  10;  25;  25;  10;   5;   5 ]
    [   0;   0;   0;  20;  20;   0;   0;   0 ]
    [   5;  -5; -10;   0;   0; -10;  -5;   5 ]
    [   5;  10;  10; -20; -20;  10;  10;   5 ]
    [   0;   0;   0;   0;   0;   0;   0;   0 ] ]

let private knightPST = array2D [
    [ -50; -40; -30; -30; -30; -30; -40; -50 ]
    [ -40; -20;   0;   0;   0;   0; -20; -40 ]
    [ -30;   0;  10;  15;  15;  10;   0; -30 ]
    [ -30;   5;  15;  20;  20;  15;   5; -30 ]
    [ -30;   0;  15;  20;  20;  15;   0; -30 ]
    [ -30;   5;  10;  15;  15;  10;   5; -30 ]
    [ -40; -20;   0;   5;   5;   0; -20; -40 ]
    [ -50; -40; -30; -30; -30; -30; -40; -50 ] ]

let private bishopPST = array2D [
    [ -20; -10; -10; -10; -10; -10; -10; -20 ]
    [ -10;   0;   0;   0;   0;   0;   0; -10 ]
    [ -10;   0;   5;  10;  10;   5;   0; -10 ]
    [ -10;   5;   5;  10;  10;   5;   5; -10 ]
    [ -10;   0;  10;  10;  10;  10;   0; -10 ]
    [ -10;  10;  10;  10;  10;  10;  10; -10 ]
    [ -10;   5;   0;   0;   0;   0;   5; -10 ]
    [ -20; -10; -10; -10; -10; -10; -10; -20 ] ]

let private rookPST = array2D [
    [   0;   0;   0;   0;   0;   0;   0;   0 ]
    [   5;  10;  10;  10;  10;  10;  10;   5 ]
    [  -5;   0;   0;   0;   0;   0;   0;  -5 ]
    [  -5;   0;   0;   0;   0;   0;   0;  -5 ]
    [  -5;   0;   0;   0;   0;   0;   0;  -5 ]
    [  -5;   0;   0;   0;   0;   0;   0;  -5 ]
    [  -5;   0;   0;   0;   0;   0;   0;  -5 ]
    [   0;   0;   0;   5;   5;   0;   0;   0 ] ]

let private queenPST = array2D [
    [ -20; -10; -10;  -5;  -5; -10; -10; -20 ]
    [ -10;   0;   0;   0;   0;   0;   0; -10 ]
    [ -10;   0;   5;   5;   5;   5;   0; -10 ]
    [  -5;   0;   5;   5;   5;   5;   0;  -5 ]
    [   0;   0;   5;   5;   5;   5;   0;  -5 ]
    [ -10;   5;   5;   5;   5;   5;   0; -10 ]
    [ -10;   0;   5;   0;   0;   0;   0; -10 ]
    [ -20; -10; -10;  -5;  -5; -10; -10; -20 ] ]

let private kingPST = array2D [
    [ -30; -40; -40; -50; -50; -40; -40; -30 ]
    [ -30; -40; -40; -50; -50; -40; -40; -30 ]
    [ -30; -40; -40; -50; -50; -40; -40; -30 ]
    [ -30; -40; -40; -50; -50; -40; -40; -30 ]
    [ -20; -30; -30; -40; -40; -30; -30; -20 ]
    [ -10; -20; -20; -20; -20; -20; -20; -10 ]
    [  20;  20;   0;   0;   0;   0;  20;  20 ]
    [  20;  30;  10;   0;   0;  10;  30;  20 ] ]

let private piecePST (p: char) : int[,] =
    match Char.ToUpperInvariant(p) with
    | 'P' -> pawnPST
    | 'N' -> knightPST
    | 'B' -> bishopPST
    | 'R' -> rookPST
    | 'Q' -> queenPST
    | 'K' -> kingPST
    | _ -> kingPST

let evaluate (state: GameState) =
    let mutable score = 0
    for r in 0..7 do
        for c in 0..7 do
            let p = state.Board.[r, c]
            if p <> '.' then
                let isWhite = Char.IsUpper(p)
                let v = pieceValue p
                let tbl = piecePST p
                let pr = if isWhite then r else 7 - r
                let pv = tbl.[pr, c]
                if isWhite then score <- score + v + pv
                else score <- score - v - pv
    // 重复惩罚：叶局面在 RepHistory 中出现过 → 引导搜索规避重复、减少三重复和棋。
    match state.RepHistory with
    | Some rep ->
        let key = state.PositionKeySimple()
        match rep.TryFind(key) with
        | Some cnt when cnt > 0 -> score <- score - RepetitionPenalty * cnt
        | _ -> ()
    | None -> ()
    if state.WhiteToMove then score else -score

let rec quiescence (state: GameState) alpha beta qdepth =
    let stand = evaluate state
    let mutable a = if stand > alpha then stand else alpha
    if stand >= beta then stand
    elif qdepth <= 0 then stand
    else
        let mutable best = stand
        let capturesArr = generateAllLegalMoves state |> Seq.filter (fun m -> m.Captured <> '.') |> Array.ofSeq
        let mutable i = 0
        let mutable cut = false
        while i < capturesArr.Length && not cut do
            let m = capturesArr.[i]
            let ns = state.CloneLight()
            applyMove ns m false
            let score = -quiescence ns (-beta) (-a) (qdepth - 1)
            if score > best then best <- score
            if best > a then a <- best
            if a >= beta then cut <- true
            i <- i + 1
        best

let rec negamax (state: GameState) depth alpha beta =
    let moves = generateAllLegalMoves state
    if moves.Count = 0 then
        if isInCheck state state.WhiteToMove then -(1000000 + depth) else 0
    elif depth = 0 then
        quiescence state alpha beta 4
    else
        // Alpha-beta beta-cutoff. F#'s `for` loop has no `break`, so the original
        // `if a >= beta then ()` was a no-op and the tree was never pruned — which
        // made F# orders of magnitude slower than the pruned engines and blew past
        // the 60s per-move RPC timeout at depth 4. Use an explicit while-loop with
        // a `cut` flag to actually stop searching this node once it's refuted.
        let mutable best = -2000000
        let mutable a = alpha
        let mutable i = 0
        let mutable cut = false
        while i < moves.Count && not cut do
            let m = moves.[i]
            let ns = state.CloneLight()
            applyMove ns m false
            let score = -negamax ns (depth - 1) (-beta) (-a)
            if score > best then best <- score
            if best > a then a <- best
            if a >= beta then cut <- true
            i <- i + 1
        best

let findBestMove (state: GameState) depth =
    let moves = generateAllLegalMoves state
    if moves.Count = 0 then failwith "no legal moves"
    let mutable bestMove = moves.[0]
    let mutable bestScore = -2000000
    let mutable a = -2000000
    for m in moves do
        let ns = state.CloneLight()
        applyMove ns m false
        let score = -negamax ns (depth - 1) (-2000000) (-a)
        if score > bestScore then
            bestScore <- score
            bestMove <- m
        if bestScore > a then a <- bestScore
    bestMove
