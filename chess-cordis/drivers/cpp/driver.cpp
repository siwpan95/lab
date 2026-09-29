// chess-cordis harness-side driver for CppChess (NOT part of the engine).
// Compiled together with the CppChess core (chess_core.cpp + chess_ai.cpp) — the
// engine itself stays zero-dependency and cordis-unaware. Serves perft /
// legalMoves / bestMove over line-delimited JSON on stdin/stdout.
//
// Build (from chess-cordis):
//   g++.exe -O2 -std=c++17 -I CppChess
//     drivers/cpp/driver.cpp CppChess/chess_core.cpp CppChess/chess_ai.cpp
//     -o drivers/cpp/cppchess_driver.exe
#include "chess_core.h"
#include "chess_ai.h"

#include <cctype>
#include <iostream>
#include <optional>
#include <sstream>
#include <string>
#include <vector>
#include <unordered_map>

using namespace std;

// ---------- minimal JSON field extractor ----------

static string getField(const string& s, const string& key) {
    string pat = "\"" + key + "\"";
    size_t idx = s.find(pat);
    if (idx == string::npos) return "";
    size_t i = idx + pat.size();
    while (i < s.size() && s[i] != ':') i++;
    if (i >= s.size()) return "";
    i++;  // skip ':'
    while (i < s.size() && (s[i] == ' ' || s[i] == '\t')) i++;
    if (i >= s.size()) return "";
    if (s[i] == '"') {
        i++;
        size_t end = s.find('"', i);
        if (end == string::npos) return "";
        return s.substr(i, end - i);
    }
    size_t end = s.find_first_of(",}", i);
    if (end == string::npos) end = s.size();
    return s.substr(i, end - i);
}

// ---------- history array (engine.mjs position keys) extractor ----------
// Parses a JSON array of strings:  "history":["key1","key2",...]
static vector<string> getHistoryArray(const string& s) {
    vector<string> out;
    string pat = "\"history\"";
    size_t idx = s.find(pat);
    if (idx == string::npos) return out;
    size_t i = s.find('[', idx);
    if (i == string::npos) return out;
    i++;
    while (i < s.size()) {
        if (s[i] == ']') break;
        if (s[i] == '"') {
            i++;
            size_t end = s.find('"', i);
            if (end == string::npos) break;
            out.push_back(s.substr(i, end - i));
            i = end + 1;
        } else {
            i++;
        }
    }
    return out;
}

// ---------- FEN parsing (mirrors the engine's own setup) ----------

static GameState fromFen(const string& fen) {
    GameState s;  // default ctor prefills the start position
    for (int r = 0; r < 8; r++)
        for (int c = 0; c < 8; c++) s.board[r][c] = '.';
    istringstream iss(fen);
    string placement, side = "w", castling = "-", ep = "-";
    int halfmove = 0, fullmove = 1;
    iss >> placement >> side >> castling >> ep >> halfmove >> fullmove;
    int r = 0, c = 0;
    for (char ch : placement) {
        if (ch == '/') { r++; c = 0; if (r >= 8) break; continue; }
        if (ch >= '1' && ch <= '9') { c += (ch - '0'); continue; }
        // CWE-787 guard: reject out-of-bounds writes on malformed FEN
        // (too many ranks/files). Harness feeds only valid golden FENs, so
        // well-formed input is unaffected; this prevents heap/stack corruption
        // if an untrusted FEN is ever supplied (e.g. over a network UI).
        if (r < 8 && c < 8) s.board[r][c] = ch;
        c++;
    }
    s.whiteToMove = (side == "w");
    s.canCastleWK = castling.find('K') != string::npos;
    s.canCastleWQ = castling.find('Q') != string::npos;
    s.canCastleBK = castling.find('k') != string::npos;
    s.canCastleBQ = castling.find('q') != string::npos;
    if (ep != "-" && ep.size() == 2) {
        s.enPassantCol = ep[0] - 'a';
        s.enPassantRow = 8 - (ep[1] - '0');
    } else {
        s.enPassantRow = -1;
        s.enPassantCol = -1;
    }
    s.halfmoveClock = halfmove;
    s.fullmoveNumber = fullmove;
    s.history.clear();
    s.positionKeys.clear();
    return s;
}

static string moveToUci(const Move& m) {
    const string files = "abcdefgh";
    string uci;
    uci += files[m.fromCol];
    uci += char('0' + (8 - m.fromRow));
    uci += files[m.toCol];
    uci += char('0' + (8 - m.toRow));
    if (m.promotion != '.') uci += char(tolower((unsigned char)m.promotion));
    return uci;
}

static long long perft(GameState s, int depth) {
    if (depth == 0) return 1;
    vector<Move> moves = Rules::GenerateAllLegalMoves(s);
    if (depth == 1) return (long long)moves.size();
    long long count = 0;
    for (const auto& m : moves) {
        GameState child = s.Clone();
        Rules::ApplyMove(child, m, false);
        count += perft(child, depth - 1);
    }
    return count;
}

int main() {
    ios::sync_with_stdio(false);
    cout << "{\"ready\":true}\n";
    cout.flush();
    string line;
    while (getline(cin, line)) {
        if (line.empty()) continue;
        string id = getField(line, "id");
        string cmd = getField(line, "cmd");
        string fen = getField(line, "fen");
        string dstr = getField(line, "depth");
        int depth = dstr.empty() ? 0 : stoi(dstr);
        vector<string> history = getHistoryArray(line);
        GameState s = fromFen(fen);  // 注意：fromFen 保留 RepHistory 为 null
        if (cmd == "perft") {
            long long n = perft(s, depth);
            cout << "{\"id\":\"" << id << "\",\"ok\":true,\"nodes\":" << n << "}\n";
            cout.flush();
        } else if (cmd == "legalMoves") {
            int n = (int)Rules::GenerateAllLegalMoves(s).size();
            cout << "{\"id\":\"" << id << "\",\"ok\":true,\"moves\":" << n << "}\n";
            cout.flush();
        } else if (cmd == "bestMove") {
            // 由 runner 传来的 history（本局此前见过的 engine.mjs 键）构建重复惩罚查找表。
            // 非空才施加惩罚；空/absent 则保持 RepHistory 为 null。
            if (!history.empty()) {
                unordered_map<string, int>* rep = new unordered_map<string, int>();
                for (const string& k : history) (*rep)[k]++;
                s.RepHistory = rep;
            }
            optional<Move> mv = AIEngine::FindBestMove(s, depth);
            if (s.RepHistory) { delete s.RepHistory; s.RepHistory = nullptr; }
            if (mv.has_value()) {
                cout << "{\"id\":\"" << id << "\",\"ok\":true,\"move\":\""
                     << moveToUci(mv.value()) << "\",\"score\":0}\n";
            } else {
                cout << "{\"id\":\"" << id << "\",\"ok\":true,\"move\":null,\"score\":0}\n";
            }
            cout.flush();
        } else if (cmd == "positionKey") {
            // 只读校验辅助：返回所请求 FEN 的 engine.mjs 兼容键。
            cout << "{\"id\":\"" << id << "\",\"ok\":true,\"key\":\""
                 << s.PositionKeySimple() << "\"}\n";
            cout.flush();
        } else {
            cout << "{\"id\":\"" << id << "\",\"ok\":false,\"error\":\"unknown cmd\"}\n";
            cout.flush();
        }
    }
    return 0;
}
