// =============================================================================
// chess_core.h — 国际象棋核心引擎（C++17）
// -----------------------------------------------------------------------------
// 架构（与 VB 版 VBChess 对齐）：
//   1. 数据层：GameState（棋盘 + 行棋方 + 易位权 + 过路兵目标格 + 计数器）
//   2. 规则层：Rules（伪合法走法生成 → 在副本上模拟走子 → IsAttacked 过滤）
//   3. 终局层：将军 / 将死 / 逼和 / 50 步规则 / 子力不足 / 三次重复
//
// 棋盘表示（mailbox 方案，8x8 二维字符数组）：
//   board[row][col]
//     row 0 = 第 8 横线（黑方底线，屏幕上方）
//     row 7 = 第 1 横线（白方底线，屏幕下方）
//   大写 = 白方棋子  K Q R B N P
//   小写 = 黑方棋子  k q r b n p
//   '.'   = 空格
//
// 核心思路（与 VB 版一致）：
//   - IsAttacked() 单一例程支撑整个规则库（将军检测 / 易位路径安全 / 合法性过滤）
//   - 合法走法 = 伪合法走法（几何规则） - 会使己方王被攻击的走法
//     （在棋盘状态副本上模拟执行后检验，即经典“试走过滤”方案）
// =============================================================================

#ifndef CHESS_CORE_H
#define CHESS_CORE_H

#include <string>
#include <vector>
#include <unordered_map>

// ---------------------------- 特殊走法类型 ----------------------------
enum class SpecialMove {
    None = 0,
    DoublePawn = 1,    // 兵双重进兵（设置过路兵目标格）
    EnPassant = 2,     // 吃过路兵
    CastleKingside = 3,// 短易位（王翼易位）
    CastleQueenside = 4,// 长易位（后翼易位）
    Promotion = 5      // 兵升变
};

// ---------------------------- 走法结构 ----------------------------
struct Move {
    int fromRow = 0;
    int fromCol = 0;
    int toRow = 0;
    int toCol = 0;
    char piece = '.';     // 走动的棋子
    char captured = '.';  // 被吃的棋子（'.' = 未吃子；过路兵填被吃兵）
    SpecialMove special = SpecialMove::None;
    char promotion = '.'; // 升变目标棋子（升变时有效）

    bool isCapture() const { return captured != '.'; }

    bool operator==(const Move& o) const {
        return fromRow == o.fromRow && fromCol == o.fromCol &&
               toRow == o.toRow && toCol == o.toCol &&
               piece == o.piece && special == o.special && promotion == o.promotion;
    }

    // 长式代数记谱（无歧义）
    std::string toString() const;
};

// ---------------------------- 对局状态 ----------------------------
class GameState {
public:
    char board[8][8];
    bool whiteToMove = true;
    // 易位权（跟踪王/车是否动过、角上车是否被吃）
    bool canCastleWK = true;
    bool canCastleWQ = true;
    bool canCastleBK = true;
    bool canCastleBQ = true;
    // 过路兵目标格（上一步双进兵跳过的格），-1 表示无
    int enPassantRow = -1;
    int enPassantCol = -1;
    // 50 步规则半步计数（吃子或动兵清零）
    int halfmoveClock = 0;
    int fullmoveNumber = 1;
    // 记谱历史（长式代数记谱）
    std::vector<std::string> history;
    // 局面键历史（三次重复判和：棋盘+行棋方+易位权+过路兵格）
    std::vector<std::string> positionKeys;
    // RepHistory：runner 本局此前见过的 engine.mjs 兼容局面键（含计数），供重复惩罚使用。
    // 以共享指针方式存在：搜索过程只读取、从不修改，Clone/CloneLight 浅拷贝同一个 map，
    // 不做深拷贝（性能 + 一致性）。nullptr ⇒ 不施加惩罚。
    std::unordered_map<std::string, int>* RepHistory = nullptr;

    GameState() { ResetToStartPosition(); }

    void ResetToStartPosition();

    // 局面键：影响重复判定的全部状态（HasLegalEnPassant 决定 ep 是否编码）
    std::string GetPositionKey() const;
    // engine.mjs 兼容局面键：易位权无 '-' 分隔符（仅拼接存在的权利），
    // 过路兵用存储值（enPassantRow/Col）而非 HasLegalEnPassant。必须与
    // engine.mjs.getPositionKey 完全一致，否则重复惩罚永不触发。
    std::string PositionKeySimple() const;

    // 深拷贝（含记谱与局面键）
    GameState Clone() const;
    // 轻量克隆（AI 搜索专用：跳过记谱与局面键拷贝，降低每节点开销）
    GameState CloneLight() const;
};

// ---------------------------- 规则引擎 ----------------------------
class Rules {
public:
    // ===== 基础工具 =====
    static bool InBoard(int r, int c);
    static bool IsWhitePiece(char p);
    static bool IsBlackPiece(char p);
    static bool IsPieceOfSide(char p, bool white);

    // ===== IsAttacked：单一例程支撑整个规则库 =====
    static bool IsAttacked(const char board[8][8], int r, int c, bool byWhite);

    // ===== 伪合法走法生成（仅几何规则，未过滤送王） =====
    static std::vector<Move> GeneratePseudoMoves(const GameState& state, int r, int c);

    // ===== 合法走法（两阶段：模拟走子过滤送王着法） =====
    static std::vector<Move> GenerateLegalMoves(const GameState& state, int r, int c);
    static std::vector<Move> GenerateAllLegalMoves(const GameState& state);

    // ===== 走子执行（增量更新状态） =====
    // recordHistory=false 供 AI 搜索路径使用（跳过记谱与局面键，降低开销）
    static void ApplyMove(GameState& state, const Move& m, bool recordHistory = true);

    // ===== 王定位与将军检测 =====
    static void FindKing(const char board[8][8], bool isWhite, int& r, int& c);
    static bool IsInCheck(const GameState& state, bool isWhite);

    // ===== 终局判定 =====
    static bool IsCheckmate(const GameState& state);
    static bool IsStalemate(const GameState& state);
    static bool IsFiftyMoveDraw(const GameState& state);
    // 是否存在合法的吃过路兵着法（供三次重复局面键决定是否编码 ep 格）
    static bool HasLegalEnPassant(const GameState& state);
    static bool IsThreefoldRepetition(const GameState& state);
    // 子力不足和棋（扩展版：KK / K+单象 / K+单马 / KNN / 异色格象组合等真实和棋）
    static bool IsInsufficientMaterial(const GameState& state);

private:
    static void GeneratePawnMoves(std::vector<Move>& list, const GameState& state,
                                  int r, int c, bool isWhite, char enemyPawn);
    static void AddPawnMove(std::vector<Move>& list, int fr, int fc, int tr, int tc,
                            char captured, SpecialMove special, bool isWhite);
    static void GenerateOffsetMoves(std::vector<Move>& list, const char board[8][8],
                                    int r, int c, bool isWhite,
                                    const int dr[], const int dc[], int n);
    static void GenerateSlidingMoves(std::vector<Move>& list, const char board[8][8],
                                     int r, int c, bool isWhite,
                                     const int dr[], const int dc[], int n);
    static void GenerateCastlingMoves(std::vector<Move>& list, const GameState& state,
                                      int r, int c, bool isWhite);
};

#endif // CHESS_CORE_H
