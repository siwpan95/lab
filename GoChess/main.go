// =============================================================================
// main.go — 国际象棋引擎入口（Go，与 C++ main.cpp 对等）
// -----------------------------------------------------------------------------
// 子命令（port_spec 规范）：
//   go run .                运行 97 项自测（默认）
//   go run . test           运行 97 项自测
//   go run . selfplay N D  AI(白) vs AI(黑) 各走 N 步，搜索深度 D
//   go run . bench D        从初始局面做 FindBestMove 计时（深度 D）
//   go run . play [ai]      文本交互对弈；加 ai 则人类执白、AI(黑) 接手
//
// 零第三方依赖，仅用标准库。引擎核心与 Cordis 无关；JSON-stdio 服务由
// chess-cordis harness 承载，不在本引擎内。
// =============================================================================

package main

import (
	"bufio"
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"
)

// ---------------------------- 棋盘渲染 ----------------------------
func printBoard(s *GameState) {
	fmt.Println("  +------------------------+")
	for r := 0; r < 8; r++ {
		fmt.Printf("%d | ", 8-r)
		for c := 0; c < 8; c++ {
			p := s.Board[r][c]
			if p == '.' {
				fmt.Print(". ")
			} else {
				fmt.Printf("%c ", p)
			}
		}
		fmt.Println("|")
	}
	fmt.Println("  +------------------------+")
	fmt.Println("    a b c d e f g h")
}

// ---------------------------- 坐标解析 ----------------------------
// ParseSquare("e2") -> (row=8-(digit), col=letter-'a')
func parseSquare(sq string) (int, int, bool) {
	if len(sq) != 2 {
		return 0, 0, false
	}
	if sq[0] < 'a' || sq[0] > 'h' {
		return 0, 0, false
	}
	if sq[1] < '1' || sq[1] > '8' {
		return 0, 0, false
	}
	col := int(sq[0] - 'a')
	row := 8 - int(sq[1]-'0')
	return row, col, true
}

// ---------------------------- 子命令 ----------------------------
func cmdSelfplay(nmoves, depth int) {
	s := NewGame()
	fmt.Printf("=== AI vs AI 自对弈（深度 %d，各 %d 步） ===\n", depth, nmoves)
	for i := 0; i < nmoves; i++ {
		all := GenerateAllLegalMoves(&s)
		if len(all) == 0 {
			fmt.Print("对局结束：")
			if IsInCheck(&s, s.WhiteToMove) {
				if s.WhiteToMove {
					fmt.Println("黑方将死白方")
				} else {
					fmt.Println("白方将死黑方")
				}
			} else {
				fmt.Println("逼和/和棋")
			}
			printBoard(&s)
			return
		}
		best := FindBestMove(&s, depth)
		if best == nil {
			fmt.Println("无最佳走法（异常）")
			return
		}
		ApplyMove(&s, *best, true)
		who := "白"
		if !s.WhiteToMove {
			who = "黑"
		}
		fmt.Printf("%s: %s\n", who, best.String())
	}
	printBoard(&s)
	fmt.Printf("半步计数: %d  走子历史条数: %d\n", s.HalfmoveClock, len(s.History))
}

func cmdBench(depth int) {
	s := NewGame()
	start := time.Now()
	best := FindBestMove(&s, depth)
	elapsed := time.Since(start)
	if best != nil {
		fmt.Printf("深度 %d 建议走法: %s  (%d ms)\n", depth, best.String(), elapsed.Milliseconds())
	} else {
		fmt.Println("无走法")
	}
}

func cmdPlay(vsAI bool) {
	s := NewGame()
	depth := 2
	fmt.Println("文本国际象棋。输入走法如 e2e4；升变自动选后；输入 new 重开，quit 退出。")
	printBoard(&s)
	reader := bufio.NewReader(os.Stdin)
	for {
		if len(GenerateAllLegalMoves(&s)) == 0 {
			fmt.Print("对局结束：")
			if IsInCheck(&s, s.WhiteToMove) {
				if s.WhiteToMove {
					fmt.Println("黑方将死白方")
				} else {
					fmt.Println("白方将死黑方")
				}
			} else {
				fmt.Println("逼和/和棋")
			}
			break
		}
		aiTurn := vsAI && !s.WhiteToMove
		if aiTurn {
			best := FindBestMove(&s, depth)
			if best == nil {
				fmt.Println("AI 无走法")
				break
			}
			ApplyMove(&s, *best, true)
			fmt.Printf("AI(黑): %s\n", best.String())
			printBoard(&s)
			continue
		}

		turn := "白方"
		if !s.WhiteToMove {
			turn = "黑方"
		}
		fmt.Printf("%s走子> ", turn)
		line, err := reader.ReadString('\n')
		if err != nil {
			break
		}
		line = strings.TrimSpace(line)
		if line == "quit" || line == "exit" {
			break
		}
		if line == "new" {
			s = NewGame()
			printBoard(&s)
			continue
		}

		var from, to string
		if len(line) >= 4 {
			from = line[0:2]
			to = line[2:4]
		} else {
			fmt.Println("格式错误（示例 e2e4）")
			continue
		}

		fr, fc, ok1 := parseSquare(from)
		tr, tc, ok2 := parseSquare(to)
		if !ok1 || !ok2 {
			fmt.Println("坐标非法")
			continue
		}
		var chosen *Move
		for _, m := range GenerateLegalMoves(&s, fr, fc) {
			if m.ToRow == tr && m.ToCol == tc {
				if m.Special == SpecialPromotion && m.Promotion != 'Q' {
					continue
				}
				mv := m
				chosen = &mv
			}
		}
		if chosen == nil {
			fmt.Println("非法走法")
			continue
		}
		ApplyMove(&s, *chosen, true)
		printBoard(&s)
		if IsInCheck(&s, s.WhiteToMove) {
			fmt.Println("将军！")
		}
	}
}

// ---------------------------- 入口 ----------------------------
func main() {
	args := os.Args
	if len(args) >= 2 {
		cmd := args[1]
		switch cmd {
		case "test":
			os.Exit(RunTests())
		case "selfplay":
			n, d := 8, 2
			if len(args) >= 3 {
				n, _ = strconv.Atoi(args[2])
			}
			if len(args) >= 4 {
				d, _ = strconv.Atoi(args[3])
			}
			cmdSelfplay(n, d)
			os.Exit(0)
		case "bench":
			d := 3
			if len(args) >= 3 {
				d, _ = strconv.Atoi(args[2])
			}
			cmdBench(d)
			os.Exit(0)
		case "play":
			ai := len(args) >= 3 && args[2] == "ai"
			cmdPlay(ai)
			os.Exit(0)
		default:
			fmt.Printf("未知子命令: %s\n", cmd)
			fmt.Println("可用: test | selfplay [N] [D] | bench [D] | play [ai]")
			os.Exit(1)
		}
	}
	// 默认运行自测
	os.Exit(RunTests())
}
