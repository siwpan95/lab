// chess-cordis harness-side driver for GoChess (NOT part of the engine).
// Compiled together with the GoChess core (chess_core.go + chess_ai.go) — the
// engine itself stays zero-dependency and cordis-unaware. Serves perft /
// legalMoves / bestMove over line-delimited JSON on stdin/stdout.
package main

import (
	"bufio"
	"encoding/json"
	"fmt"
	"os"
	"strings"
)

// ---------- JSON-stdio request / response ----------

type request struct {
	ID    string   `json:"id"`
	Cmd   string   `json:"cmd"`
	Fen   string   `json:"fen"`
	Depth float64  `json:"depth"`
	// History: engine.mjs position keys seen so far this game (excludes the
	// current position). Used by the repetition penalty in chess_ai.go. Absent/empty ⇒ no penalty.
	History []string `json:"history"`
	// TimeMs: Tier 2-B optional per-move budget in milliseconds.
	// Absent/0 ⇒ fixed-depth search (behaviour unchanged from before Tier 2-B).
	TimeMs float64 `json:"timeMs"`
}

func send(out *bufio.Writer, obj interface{}) {
	_ = json.NewEncoder(out).Encode(obj)
	_ = out.Flush()
}

// ---------- FEN parsing (mirrors the engine's own setup) ----------

func fromFen(fen string) GameState {
	var s GameState
	s.ResetToStartPosition()
	// Clear the prefilled start board; FEN placement overwrites every square.
	for r := 0; r < 8; r++ {
		for c := 0; c < 8; c++ {
			s.Board[r][c] = '.'
		}
	}
	parts := strings.Fields(fen)
	placement := ""
	side := "w"
	castling := "-"
	ep := "-"
	halfmove := 0
	fullmove := 1
	if len(parts) > 0 {
		placement = parts[0]
	}
	if len(parts) > 1 {
		side = parts[1]
	}
	if len(parts) > 2 {
		castling = parts[2]
	}
	if len(parts) > 3 {
		ep = parts[3]
	}
	if len(parts) > 4 {
		halfmove, _ = fmt.Sscanf(parts[4], "%d", new(int))
	}
	if len(parts) > 5 {
		fullmove, _ = fmt.Sscanf(parts[5], "%d", new(int))
	}

	r := 0
	c := 0
	for _, ch := range placement {
		if ch == '/' {
			r++
			c = 0
			continue
		}
		if ch >= '1' && ch <= '9' {
			c += int(ch - '0')
			continue
		}
		s.Board[r][c] = byte(ch)
		c++
	}

	s.WhiteToMove = side == "w"
	s.CanCastleWK = strings.Contains(castling, "K")
	s.CanCastleWQ = strings.Contains(castling, "Q")
	s.CanCastleBK = strings.Contains(castling, "k")
	s.CanCastleBQ = strings.Contains(castling, "q")
	if ep != "-" && len(ep) == 2 {
		s.EnPassantCol = int(ep[0] - 'a')
		s.EnPassantRow = 8 - int(ep[1]-'0')
	} else {
		s.EnPassantRow = -1
		s.EnPassantCol = -1
	}
	s.HalfmoveClock = halfmove
	s.FullmoveNumber = fullmove
	s.History = nil
	s.PositionKeys = nil
	return s
}

func moveToUci(m Move) string {
	files := "abcdefgh"
	uci := string(files[m.FromCol]) + fmt.Sprint(8-m.FromRow) +
		string(files[m.ToCol]) + fmt.Sprint(8-m.ToRow)
	if m.Promotion != '.' {
		uci += strings.ToLower(string(m.Promotion))
	}
	return uci
}

func perft(s *GameState, depth int) int64 {
	if depth == 0 {
		return 1
	}
	moves := GenerateAllLegalMoves(s)
	if depth == 1 {
		return int64(len(moves))
	}
	var count int64
	for _, m := range moves {
		child := s.Clone()
		ApplyMove(&child, m, false)
		count += perft(&child, depth-1)
	}
	return count
}

func main() {
	out := bufio.NewWriter(os.Stdout)
	send(out, map[string]bool{"ready": true})

	scanner := bufio.NewScanner(os.Stdin)
	scanner.Buffer(make([]byte, 1<<20), 1<<20)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}
		var req request
		if err := json.Unmarshal([]byte(line), &req); err != nil {
			continue
		}
		depth := int(req.Depth)
		s := fromFen(req.Fen)
		switch req.Cmd {
		case "perft":
			send(out, map[string]interface{}{"id": req.ID, "ok": true, "nodes": perft(&s, depth)})
		case "legalMoves":
			send(out, map[string]interface{}{"id": req.ID, "ok": true, "moves": len(GenerateAllLegalMoves(&s))})
		case "bestMove":
			// Build the repetition-penalty lookup from the runner-supplied history
			// (engine.mjs position keys seen so far). Empty/absent ⇒ no penalty.
			if len(req.History) > 0 {
				rep := make(map[string]int, len(req.History))
				for _, k := range req.History {
					rep[k]++
				}
				s.RepHistory = rep
			}
			mv := FindBestMoveTimed(&s, depth, int(req.TimeMs))
			if mv == nil {
				send(out, map[string]interface{}{"id": req.ID, "ok": true, "move": nil, "score": 0})
			} else {
				send(out, map[string]interface{}{"id": req.ID, "ok": true, "move": moveToUci(*mv), "score": 0})
			}
		case "positionKey":
			// Read-only verification aid: returns the engine.mjs-compatible key of
			// the requested FEN. Not used by the tournament runner.
			send(out, map[string]interface{}{"id": req.ID, "ok": true, "key": s.PositionKeySimple()})
		case "evalProfile":
			// Read-only verification aid: returns this engine's Tier 2-C eval
			// profile name and its djb2-32 hash (same algorithm as the harness).
			send(out, map[string]interface{}{"id": req.ID, "ok": true,
				"profile": EvalProfile.Name, "hash": ProfileHash()})
		default:
			send(out, map[string]interface{}{"id": req.ID, "ok": false, "error": "unknown cmd"})
		}
	}
}
