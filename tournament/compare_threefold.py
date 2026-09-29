#!/usr/bin/env python3
# Rigorous threefold comparison between the pre-penalty baseline and the
# penalty-augmented run. Isolates the 9-engine mutual sub-tournament
# (excluding fs) so the comparison is not confounded by fs's crash in the
# baseline (18 forfeit losses there vs 18 real games in the new run).
import re, sys

EXCLUDE = {'fs'}  # fs crashed in baseline -> exclude from the "fair" set

def parse(path):
    games = []  # (engA, engB, result_reason)
    cur = None
    sec_re = re.compile(r'^###\s+(\w+)\s*\(.*?\)\s+vs\s+(\w+)\s*\(')
    game_re = re.compile(r'^\*\*第\s*\d+\s*局\*\*.*—\s*(.+)$')
    for line in open(path, encoding='utf-8'):
        m = sec_re.match(line.strip())
        if m:
            cur = (m.group(1), m.group(2))
            continue
        g = game_re.match(line.strip())
        if g and cur:
            games.append((cur[0], cur[1], g.group(1).strip()))
    return games

def stats(games, only_mutual=False):
    tot = tf = dr = dec = 0
    for a, b, res in games:
        if only_mutual and (a in EXCLUDE or b in EXCLUDE):
            continue
        tot += 1
        if 'threefold' in res:
            tf += 1
        elif '和棋' in res or '和局' in res:
            dr += 1
        else:
            dec += 1
    rate = (100.0 * tf / tot) if tot else 0.0
    return tot, tf, dr, dec, rate

base = r'D:/projects/lab/tournament/reports/2026-09-29__baseline_prePenalty.md'
new  = r'D:/projects/lab/tournament/reports/2026-09-29.md'

for label, path in [('BASELINE (no penalty, fs crashed)', base), ('NEW (penalty on, fs fixed)', new)]:
    games = parse(path)
    t_all, tf_all, dr_all, dec_all, r_all = stats(games, only_mutual=False)
    t_m, tf_m, dr_m, dec_m, r_m = stats(games, only_mutual=True)
    print(f'=== {label} ===')
    print(f'  ALL    : games={t_all:3d}  threefold={tf_all:3d}  otherDraws={dr_all:3d}  decisive={dec_all:3d}  tf%={r_all:.1f}')
    print(f'  9-mut  : games={t_m:3d}  threefold={tf_m:3d}  otherDraws={dr_m:3d}  decisive={dec_m:3d}  tf%={r_m:.1f}')
    print()

# Delta on the fair 9-mutual set
gb = parse(base); gn = parse(new)
_, tf_b, _, _, r_b = stats(gb, only_mutual=True)
_, tf_n, _, _, r_n = stats(gn, only_mutual=True)
print(f'FAIR COMPARISON (9-engine mutual, excl fs):')
print(f'  baseline threefold = {tf_b}/72 = {r_b:.1f}%')
print(f'  new      threefold = {tf_n}/72 = {r_n:.1f}%')
print(f'  delta               = {tf_n - tf_b:+d} games  ({r_n - r_b:+.1f} pp)')
