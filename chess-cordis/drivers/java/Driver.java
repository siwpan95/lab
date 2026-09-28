// =============================================================================
// Driver.java — chess-cordis harness-side JSON-stdio driver for JavaChess
// -----------------------------------------------------------------------------
// Reuses the pure JavaChess core (GameState / Rules / AIEngine) and serves perft /
// bestMove over line-delimited JSON. This file belongs to the harness, not the
// engine; the engine itself stays zero-dependency and cordis-unaware.
//
// The JavaChess core classes live in the default package (no `package` decl), so
// this driver does too, and is compiled alongside ChessCore.java / ChessAI.java.
// =============================================================================

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;

public class Driver {

    // FEN -> GameState (full castling/ep/halfmove/fullmove support).
    static GameState setupFromFen(String fen) {
        String[] parts = fen.split("\\s+");
        String[] ranks = parts[0].split("/");
        String side = parts.length > 1 ? parts[1] : "w";
        String castling = parts.length > 2 ? parts[2] : "-";
        String ep = parts.length > 3 ? parts[3] : "-";
        int halfmove = parts.length > 4 ? Integer.parseInt(parts[4]) : 0;
        int fullmove = parts.length > 5 ? Integer.parseInt(parts[5]) : 1;

        GameState s = new GameState();
        for (int r = 0; r < 8; ++r) {
            String rank = ranks[r];
            int col = 0;
            for (int i = 0; i < rank.length(); ++i) {
                char ch = rank.charAt(i);
                if (Character.isDigit(ch)) {
                    int n = ch - '0';
                    for (int k = 0; k < n; ++k) s.board[r][col++] = '.';
                } else {
                    s.board[r][col++] = ch;
                }
            }
        }
        s.whiteToMove = side.equals("w");
        s.canCastleWK = castling.indexOf('K') >= 0;
        s.canCastleWQ = castling.indexOf('Q') >= 0;
        s.canCastleBK = castling.indexOf('k') >= 0;
        s.canCastleBQ = castling.indexOf('q') >= 0;
        s.enPassantRow = -1;
        s.enPassantCol = -1;
        if (ep.length() == 2) {
            s.enPassantCol = ep.charAt(0) - 'a';
            s.enPassantRow = 8 - (ep.charAt(1) - '0');
        }
        s.halfmoveClock = halfmove;
        s.fullmoveNumber = fullmove;
        s.history.clear();
        s.positionKeys.clear();
        return s;
    }

    static long perft(GameState state, int depth) {
        if (depth == 0) return 1;
        List<Move> moves = Rules.GenerateAllLegalMoves(state);
        if (depth == 1) return moves.size();
        long count = 0;
        for (Move m : moves) {
            GameState child = state.Clone();
            Rules.ApplyMove(child, m, false);
            count += perft(child, depth - 1);
        }
        return count;
    }

    static String j(String v) {
        if (v == null) return "";
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < v.length(); ++i) {
            char c = v.charAt(i);
            switch (c) {
                case '"': sb.append("\\\""); break;
                case '\\': sb.append("\\\\"); break;
                case '\n': sb.append("\\n"); break;
                case '\r': sb.append("\\r"); break;
                case '\t': sb.append("\\t"); break;
                default: sb.append(c); break;
            }
        }
        return sb.toString();
    }

    static String moveToUci(Move m) {
        String files = "abcdefgh";
        String from = "" + files.charAt(m.fromCol) + (char) ('0' + (8 - m.fromRow));
        String to = "" + files.charAt(m.toCol) + (char) ('0' + (8 - m.toRow));
        String uci = from + to;
        if (m.promotion != '.' && m.promotion != '\0') uci += Character.toLowerCase(m.promotion);
        return uci;
    }

    // --- Minimal JSON field extractors (harness only emits id/cmd/fen/depth) ---
    // Robust against the key's own quotes: locate the `"key":` token, then find
    // the value's opening quote (after the colon) and its matching closing quote.
    static String getStr(String json, String key) {
        String needle = "\"" + key + "\":";
        int idx = json.indexOf(needle);
        if (idx < 0) return "";
        int after = idx + needle.length();          // char just past the ':'
        int open = json.indexOf('"', after);        // value's opening quote
        if (open < 0) return "";
        int close = json.indexOf('"', open + 1);    // value's closing quote
        if (close < 0) return "";
        return json.substring(open + 1, close);
    }

    // Accepts both `"depth":3` (bare integer) and quoted forms.
    static int getInt(String json, String key) {
        String needle = "\"" + key + "\":";
        int idx = json.indexOf(needle);
        if (idx < 0) return 0;
        int p = idx + needle.length();
        // skip colon + any whitespace to reach the first digit/'-'
        while (p < json.length()
                && json.charAt(p) != '-'
                && !(json.charAt(p) >= '0' && json.charAt(p) <= '9')) p++;
        int start = p;
        while (p < json.length()
                && (json.charAt(p) == '-'
                    || (json.charAt(p) >= '0' && json.charAt(p) <= '9'))) p++;
        if (p == start) return 0;
        return Integer.parseInt(json.substring(start, p));
    }

    public static void main(String[] args) throws Exception {
        BufferedReader br = new BufferedReader(new InputStreamReader(System.in, StandardCharsets.UTF_8));
        System.out.println("{\"ready\":true}");
        System.out.flush();
        String line;
        while ((line = br.readLine()) != null) {
            if (line.length() == 0) continue;
            try {
                String id = getStr(line, "id");
                String cmd = getStr(line, "cmd");
                String fen = getStr(line, "fen");
                int depth = getInt(line, "depth");

                GameState state = setupFromFen(fen);
                if (cmd.equals("perft")) {
                    long nodes = perft(state, depth);
                    System.out.println("{\"id\":\"" + j(id) + "\",\"ok\":true,\"nodes\":" + Long.toString(nodes) + "}");
                } else if (cmd.equals("legalMoves")) {
                    int n = Rules.GenerateAllLegalMoves(state).size();
                    System.out.println("{\"id\":\"" + j(id) + "\",\"ok\":true,\"moves\":" + n + "}");
                } else if (cmd.equals("bestMove")) {
                    int sd = depth < 1 ? 3 : depth;
                    Move mv = AIEngine.FindBestMove(state, sd);
                    if (mv == null)
                        System.out.println("{\"id\":\"" + j(id) + "\",\"ok\":false,\"error\":\"no legal move\"}");
                    else
                        System.out.println("{\"id\":\"" + j(id) + "\",\"ok\":true,\"move\":\"" + j(moveToUci(mv)) + "\",\"score\":0}");
                } else {
                    System.out.println("{\"id\":\"" + j(id) + "\",\"ok\":false,\"error\":\"unknown cmd\"}");
                }
                System.out.flush();
            } catch (Exception ex) {
                System.out.println("{\"id\":\"\",\"ok\":false,\"error\":\"" + j(ex.getMessage()) + "\"}");
                System.out.flush();
            }
        }
    }
}
