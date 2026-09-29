// =============================================================================
// Driver.fs — chess-cordis harness-side JSON-stdio driver for F#Chess
// -----------------------------------------------------------------------------
// Reuses the pure F#Chess core (module ChessCore) and serves perft / bestMove
// over line-delimited JSON. This file belongs to the harness, not the engine;
// the engine itself stays zero-dependency and cordis-unaware.
// =============================================================================

module Driver

open System
open System.Text
open System.Text.Json
open ChessCore

// FEN -> GameState (full castling/ep/halfmove/fullmove support).
let setupFromFen (fen: string) : GameState =
    let parts = fen.Split(' ', StringSplitOptions.RemoveEmptyEntries)
    let ranks = parts.[0].Split('/')
    let side = if parts.Length > 1 then parts.[1] else "w"
    let castling = if parts.Length > 2 then parts.[2] else "-"
    let ep = if parts.Length > 3 then parts.[3] else "-"
    let halfmove = if parts.Length > 4 then Int32.Parse(parts.[4]) else 0
    let fullmove = if parts.Length > 5 then Int32.Parse(parts.[5]) else 1

    let s = GameState()
    for r in 0 .. 7 do
        let rank = ranks.[r]
        let mutable col = 0
        for ch in rank do
            if ch >= '1' && ch <= '9' then
                col <- col + int (ch - '0')
            else
                s.Board.[r, col] <- ch
                col <- col + 1
    s.WhiteToMove <- (side = "w")
    s.CanCastleWK <- castling.Contains('K')
    s.CanCastleWQ <- castling.Contains('Q')
    s.CanCastleBK <- castling.Contains('k')
    s.CanCastleBQ <- castling.Contains('q')
    s.EnPassantRow <- -1
    s.EnPassantCol <- -1
    if ep <> "-" && ep.Length = 2 then
        s.EnPassantCol <- int (ep.[0]) - int 'a'
        s.EnPassantRow <- 8 - (int (ep.[1]) - int '0')
    s.HalfmoveClock <- halfmove
    s.FullmoveNumber <- fullmove
    s

// perft recursion over the engine core.
let rec perft (state: GameState) (depth: int) : int64 =
    if depth = 0 then 1L
    else
        let moves = generateAllLegalMoves state
        if depth = 1 then int64 moves.Count
        else
            let mutable nodes = 0L
            for m in moves do
                let ns = state.CloneLight()
                applyMove ns m false
                nodes <- nodes + perft ns (depth - 1)
            nodes

let moveToUci (m: Move) : string =
    let files = "abcdefgh"
    let fromSq = "" + string files.[m.FromCol] + string (8 - m.FromRow)
    let toSq = "" + string files.[m.ToCol] + string (8 - m.ToRow)
    let mutable uci = fromSq + toSq
    if m.Promotion <> '.' && m.Promotion <> '\000' then
        uci <- uci + Char.ToLowerInvariant(m.Promotion).ToString()
    uci

// Minimal JSON string escaper (no external deps).
let j (s: string) : string =
    if isNull s then ""
    else s.Replace("\\", "\\\\").Replace("\"", "\\\"").Replace("\n", "\\n").Replace("\r", "\\r")

[<EntryPoint>]
let main _ =
    Console.OutputEncoding <- Encoding.UTF8
    printfn "{\"ready\":true}"
    Console.Out.Flush()

    let mutable line = Console.ReadLine()
    while not (isNull line) do
        if line.Trim().Length > 0 then
            try
                use doc = JsonDocument.Parse(line)
                let root = doc.RootElement
                let tryStr (key: string) =
                    let mutable v = JsonElement()
                    if root.TryGetProperty(key, &v) then v.GetString() else ""
                let tryInt (key: string) =
                    let mutable v = JsonElement()
                    if root.TryGetProperty(key, &v) then v.GetInt32() else 0
                let id = tryStr "id"
                let cmd = tryStr "cmd"
                let fen = tryStr "fen"
                let depth = tryInt "depth"

                let state = setupFromFen fen
                match cmd with
                | "perft" ->
                    let nodes = perft state depth
                    printfn "{\"id\":\"%s\",\"ok\":true,\"nodes\":%d}" (j id) nodes
                | "legalMoves" ->
                    let n = (generateAllLegalMoves state).Count
                    printfn "{\"id\":\"%s\",\"ok\":true,\"moves\":%d}" (j id) n
                | "bestMove" ->
                    // Build the repetition-penalty lookup from the runner-supplied history
                    // (engine.mjs position keys seen so far this game, excludes current).
                    // Empty/absent ⇒ no penalty.
                    let mutable hEl = JsonElement()
                    let rep =
                        if root.TryGetProperty("history", &hEl) && hEl.ValueKind = JsonValueKind.Array then
                            let keys = [
                                for i in 0 .. hEl.GetArrayLength() - 1 ->
                                    let k = hEl.[i].GetString()
                                    if isNull k then "" else k
                            ]
                            if List.isEmpty keys then None
                            else Some (keys |> List.countBy (fun x -> x) |> Map.ofList)
                        else None
                    state.RepHistory <- rep
                    let sd = if depth < 1 then 3 else depth
                    let mv = findBestMove state sd
                    printfn "{\"id\":\"%s\",\"ok\":true,\"move\":\"%s\",\"score\":0}" (j id) (j (moveToUci mv))
                | "positionKey" ->
                    // Read-only verification aid: returns the engine.mjs-compatible key
                    // of the requested FEN (must byte-match engine.mjs getPositionKey).
                    printfn "{\"id\":\"%s\",\"ok\":true,\"key\":\"%s\"}" (j id) (j (state.PositionKeySimple()))
                | "evalProfile" ->
                    // Read-only verification aid: returns this engine's Tier 2-C eval
                    // profile name and its djb2-32 hash (same algorithm as the harness).
                    printfn "{\"id\":\"%s\",\"ok\":true,\"profile\":\"%s\",\"hash\":\"%s\"}" (j id) (j evalProfile.Name) (evalProfileHash ())
                | _ ->
                    printfn "{\"id\":\"%s\",\"ok\":false,\"error\":\"unknown cmd\"}" (j id)
                Console.Out.Flush()
            with
            | ex -> printfn "{\"id\":\"\",\"ok\":false,\"error\":\"%s\"}" (j ex.Message)
        line <- Console.ReadLine()
    0
