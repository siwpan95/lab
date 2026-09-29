// =============================================================================
// Driver.cs — chess-cordis harness-side JSON-stdio driver for C#Chess
// -----------------------------------------------------------------------------
// Imports the pure CSharpChess core and serves perft / bestMove over line-
// delimited JSON. This file belongs to the harness, not the engine; the engine
// itself stays zero-dependency and cordis-unaware.
// =============================================================================

using System;
using System.Collections.Generic;
using System.Text;
using System.Text.Json;
using ChessEngine;

namespace ChessEngineDriver
{
    public static class Driver
    {
        // FEN -> GameState (full castling/ep/halfmove/fullmove support).
        private static GameState SetupFromFen(string fen)
        {
            string[] parts = fen.Split(' ', StringSplitOptions.RemoveEmptyEntries);
            string[] ranks = parts[0].Split('/');
            string side = parts.Length > 1 ? parts[1] : "w";
            string castling = parts.Length > 2 ? parts[2] : "-";
            string ep = parts.Length > 3 ? parts[3] : "-";
            int halfmove = parts.Length > 4 ? int.Parse(parts[4]) : 0;
            int fullmove = parts.Length > 5 ? int.Parse(parts[5]) : 1;

            GameState s = new GameState();
            for (int r = 0; r < 8; ++r)
            {
                string rank = ranks[r];
                int col = 0;
                foreach (char ch in rank)
                {
                    if (char.IsDigit(ch))
                    {
                        int n = ch - '0';
                        for (int k = 0; k < n; ++k) s.Board[r, col++] = '.';
                    }
                    else
                        s.Board[r, col++] = ch;
                }
            }
            s.WhiteToMove = (side == "b") ? false : true;
            s.CanCastleWK = castling.IndexOf('K') >= 0;
            s.CanCastleWQ = castling.IndexOf('Q') >= 0;
            s.CanCastleBK = castling.IndexOf('k') >= 0;
            s.CanCastleBQ = castling.IndexOf('q') >= 0;
            s.EnPassantRow = -1;
            s.EnPassantCol = -1;
            if (ep != "-" && ep.Length == 2)
            {
                s.EnPassantCol = ep[0] - 'a';
                s.EnPassantRow = 8 - (ep[1] - '0');
            }
            s.HalfmoveClock = halfmove;
            s.FullmoveNumber = fullmove;
            s.History.Clear();
            s.PositionKeys.Clear();
            return s;
        }

        private static long Perft(GameState state, int depth)
        {
            if (depth == 0) return 1;
            List<Move> moves = Rules.GenerateAllLegalMoves(state);
            if (depth == 1) return moves.Count;
            long count = 0;
            foreach (Move m in moves)
            {
                GameState child = state.Clone();
                Rules.ApplyMove(child, m);
                count += Perft(child, depth - 1);
            }
            return count;
        }

        private static string J(string v)
        {
            if (v == null) return "";
            StringBuilder sb = new StringBuilder();
            foreach (char c in v)
            {
                switch (c)
                {
                    case '"': sb.Append("\\\""); break;
                    case '\\': sb.Append("\\\\"); break;
                    case '\n': sb.Append("\\n"); break;
                    case '\r': sb.Append("\\r"); break;
                    case '\t': sb.Append("\\t"); break;
                    default: sb.Append(c); break;
                }
            }
            return sb.ToString();
        }

        private static void Emit(string line)
        {
            Console.WriteLine(line);
            Console.Out.Flush();
        }

        private static string MoveToUci(Move m)
        {
            string files = "abcdefgh";
            string from = "" + files[m.FromCol] + (char)('0' + (8 - m.FromRow));
            string to = "" + files[m.ToCol] + (char)('0' + (8 - m.ToRow));
            string uci = from + to;
            if (m.Promotion != '.' && m.Promotion != '\0')
                uci += char.ToLower(m.Promotion);
            return uci;
        }

        public static void Main(string[] args)
        {
            Console.OutputEncoding = Encoding.UTF8;
            Emit("{\"ready\":true}");
            string line;
            while ((line = Console.ReadLine()) != null)
            {
                if (line.Length == 0) continue;
                try
                {
                    using JsonDocument doc = JsonDocument.Parse(line);
                    JsonElement root = doc.RootElement;
                    string id = root.GetProperty("id").GetString() ?? "";
                    string cmd = root.GetProperty("cmd").GetString() ?? "";
                    string fen = root.GetProperty("fen").GetString() ?? "";
                    int depth = root.TryGetProperty("depth", out JsonElement d) ? d.GetInt32() : 0;

                    GameState state = SetupFromFen(fen);

                    // 读取 runner 传来的历史局面键（engine.mjs 键），构建重复惩罚计数表。
                    // 空 / 缺失 ⇒ 不设置 RepHistory（不惩罚）。
                    if (cmd == "bestMove" && root.TryGetProperty("history", out JsonElement histEl)
                        && histEl.ValueKind == JsonValueKind.Array)
                    {
                        Dictionary<string, int> rep = new Dictionary<string, int>();
                        foreach (JsonElement el in histEl.EnumerateArray())
                        {
                            string k = el.GetString() ?? "";
                            if (k.Length == 0) continue;
                            if (rep.ContainsKey(k)) rep[k]++; else rep[k] = 1;
                        }
                        if (rep.Count > 0) state.RepHistory = rep;
                    }
                    if (cmd == "perft")
                    {
                        long nodes = Perft(state, depth);
                        Emit("{\"id\":\"" + J(id) + "\",\"ok\":true,\"nodes\":" + nodes.ToString(System.Globalization.CultureInfo.InvariantCulture) + "}");
                    }
                    else if (cmd == "legalMoves")
                    {
                        int n = Rules.GenerateAllLegalMoves(state).Count;
                        Emit("{\"id\":\"" + J(id) + "\",\"ok\":true,\"moves\":" + n.ToString(System.Globalization.CultureInfo.InvariantCulture) + "}");
                    }
                    else if (cmd == "bestMove")
                    {
                        int searchDepth = depth < 1 ? 3 : depth;
                        Move? mv = AIEngine.FindBestMove(state, searchDepth);
                        if (mv == null)
                            Emit("{\"id\":\"" + J(id) + "\",\"ok\":false,\"error\":\"no legal move\"}");
                        else
                            Emit("{\"id\":\"" + J(id) + "\",\"ok\":true,\"move\":\"" + J(MoveToUci(mv)) + "\",\"score\":0}");
                    }
                    else if (cmd == "positionKey")
                    {
                        // 只读校验辅助：返回该 FEN 的 engine.mjs 兼容局面键。
                        Emit("{\"id\":\"" + J(id) + "\",\"ok\":true,\"key\":\"" + J(state.PositionKeySimple()) + "\"}");
                    }
                    else if (cmd == "evalProfile")
                    {
                        // 只读校验辅助：返回本引擎的 Tier 2-C 评估档名与 djb2-32 哈希
                        //（与 harness 侧 validate_eval_profile.mjs 同算法）。
                        Emit("{\"id\":\"" + J(id) + "\",\"ok\":true,\"profile\":\"" + J(AIEngine.ProfileName) +
                             "\",\"hash\":\"" + J(AIEngine.ProfileHash()) + "\"}");
                    }
                    else
                    {
                        Emit("{\"id\":\"" + J(id) + "\",\"ok\":false,\"error\":\"unknown cmd\"}");
                    }
                }
                catch (Exception ex)
                {
                    Emit("{\"id\":\"\",\"ok\":false,\"error\":\"" + J(ex.Message) + "\"}");
                }
            }
        }
    }
}
