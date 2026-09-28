# =============================================================================
# tools/refcheck.py — Python 参考实现（逻辑验证用，不参与 C++ 构建）
# -----------------------------------------------------------------------------
# 本文件独立复刻 CppChess（即对齐 VBChess）的算法，运行与 C++ tests.cpp 完全
# 一致的 24 个场景，用于在本沙箱无 C++ 编译器时，验证“移植逻辑”的正确性。
# 它不是 C++ 构建的一部分；仅作逻辑正确性自检。
# =============================================================================

class Special:
    NONE=0; DOUBLE=1; EP=2; CK=3; CQ=4; PROMO=5

class Move:
    __slots__=("fr","fc","tr","tc","piece","captured","special","promo")
    def __init__(s,fr,fc,tr,tc,piece,captured,special,promo='.'):
        s.fr,s.fc,s.tr,s.tc=fr,fc,tr,tc
        s.piece,s.captured,s.special,s.promo=piece,captured,special,promo
    def is_capture(self): return self.captured!='.'
    def __str__(self):
        if self.special==Special.CK: return "O-O"
        if self.special==Special.CQ: return "O-O-O"
        files="abcdefgh"
        fromSq=files[self.fc]+str(8-self.fr)
        toSq=files[self.tc]+str(8-self.tr)
        if self.piece in ('P','p'):
            s=files[self.fc] if self.is_capture() else ''
            s+=toSq
            if self.special==Special.PROMO: s+='='+self.promo.upper()
            return s
        else:
            s=self.piece.upper()+fromSq
            if self.is_capture(): s+='x'
            s+=toSq
            return s

class GameState:
    def __init__(self):
        self.Reset()
    def Reset(self):
        back="rnbqkbnr"
        self.board=[[None]*8 for _ in range(8)]
        for c in range(8):
            self.board[0][c]=back[c]; self.board[1][c]='p'
            self.board[6][c]='P'; self.board[7][c]=back[c].upper()
        self.white=True
        self.cwk=self.cwq=self.cbk=self.cbq=True
        self.epr=self.epc=-1
        self.hm=0; self.fm=1
        self.history=[]; self.keys=[]
        self.keys.append(self.key())
    def key(self):
        s=''.join(''.join(ch if ch is not None else '.' for ch in row) for row in self.board)
        s+= 'w' if self.white else 'b'
        s+= 'K' if self.cwk else '-'
        s+= 'Q' if self.cwq else '-'
        s+= 'k' if self.cbk else '-'
        s+= 'q' if self.cbq else '-'
        if Rules.has_legal_ep(self):
            s+=f"{self.epr},{self.epc}"
        else:
            s+="-1,-1"
        return s
    def clone(self):
        g=GameState.__new__(GameState)
        g.board=[row[:] for row in self.board]
        g.white=self.white; g.cwk=self.cwk; g.cwq=self.cwq
        g.cbk=self.cbk; g.cbq=self.cbq; g.epr=self.epr; g.epc=self.epc
        g.hm=self.hm; g.fm=self.fm
        g.history=list(self.history); g.keys=list(self.keys)
        return g
    def clone_light(self):
        g=GameState.__new__(GameState)
        g.board=[row[:] for row in self.board]
        g.white=self.white; g.cwk=self.cwk; g.cwq=self.cwq
        g.cbk=self.cbk; g.cbq=self.cbq; g.epr=self.epr; g.epc=self.epc
        g.hm=self.hm; g.fm=self.fm
        g.history=None; g.keys=None
        return g

class Rules:
    @staticmethod
    def in_board(r,c): return 0<=r<=7 and 0<=c<=7
    @staticmethod
    def is_white(p): return p is not None and p.isupper()
    @staticmethod
    def is_black(p): return p is not None and p.islower()
    @staticmethod
    def is_side(p,white):
        if p is None: return False
        return p.isupper() if white else p.islower()

    @staticmethod
    def attacked(b,r,c,by_white):
        pawn='P' if by_white else 'p'
        pr=r+1 if by_white else r-1
        if 0<=pr<=7:
            if c-1>=0 and b[pr][c-1]==pawn: return True
            if c+1<=7 and b[pr][c+1]==pawn: return True
        knight='N' if by_white else 'n'
        for dr,dc in [(-2,-1),(-2,1),(-1,-2),(-1,2),(1,-2),(1,2),(2,-1),(2,1)]:
            tr,tc=r+dr,c+dc
            if Rules.in_board(tr,tc) and b[tr][tc]==knight: return True
        king='K' if by_white else 'k'
        for dr in (-1,0,1):
            for dc in (-1,0,1):
                if dr==0 and dc==0: continue
                tr,tc=r+dr,c+dc
                if Rules.in_board(tr,tc) and b[tr][tc]==king: return True
        rook='R' if by_white else 'r'; queen='Q' if by_white else 'q'; bishop='B' if by_white else 'b'
        dirs=[(-1,0),(1,0),(0,-1),(0,1),(-1,-1),(-1,1),(1,-1),(1,1)]
        for i,(dr,dc) in enumerate(dirs):
            tr,tc=r+dr,c+dc
            while Rules.in_board(tr,tc):
                p=b[tr][tc]
                if p is not None:
                    if i<4:
                        if p==rook or p==queen: return True
                    else:
                        if p==bishop or p==queen: return True
                    break
                tr+=dr; tc+=dc
        return False

    @staticmethod
    def gen_pseudo(g,r,c):
        out=[]; b=g.board; p=b[r][c]
        if p is None: return out
        white=p.isupper(); enemy_pawn='p' if white else 'P'
        up=p.upper()
        if up=='P':
            Rules._pawn(out,g,r,c,white,enemy_pawn)
        elif up=='N':
            Rules._offset(out,b,r,c,white,[(-2,-1),(-2,1),(-1,-2),(-1,2),(1,-2),(1,2),(2,-1),(2,1)])
        elif up=='K':
            Rules._offset(out,b,r,c,white,[(-1,-1),(-1,0),(-1,1),(0,-1),(0,1),(1,-1),(1,0),(1,1)])
            Rules._castle(out,g,r,c,white)
        elif up=='B':
            Rules._slide(out,b,r,c,white,[(-1,-1),(-1,1),(1,-1),(1,1)])
        elif up=='R':
            Rules._slide(out,b,r,c,white,[(-1,0),(1,0),(0,-1),(0,1)])
        elif up=='Q':
            Rules._slide(out,b,r,c,white,[(-1,0),(1,0),(0,-1),(0,1),(-1,-1),(-1,1),(1,-1),(1,1)])
        return out

    @staticmethod
    def _pawn(out,g,r,c,white,enemy_pawn):
        b=g.board; d=-1 if white else 1; start=6 if white else 1
        if Rules.in_board(r+d,c) and b[r+d][c] is None:
            Rules._addpawn(out,r,c,r+d,c,'.',Special.NONE,white)
            if r==start and b[r+2*d][c] is None:
                out.append(Move(r,c,r+2*d,c,b[r][c],'.',Special.DOUBLE,'.'))
        for dc in (-1,1):
            tr,tc=r+d,c+dc
            if not Rules.in_board(tr,tc): continue
            tgt=b[tr][tc]
            if tgt is not None and Rules.is_side(tgt,not white):
                Rules._addpawn(out,r,c,tr,tc,tgt,Special.NONE,white)
            elif tr==g.epr and tc==g.epc:
                Rules._addpawn(out,r,c,tr,tc,enemy_pawn,Special.EP,white)

    @staticmethod
    def _addpawn(out,fr,fc,tr,tc,captured,special,white):
        if tr==0 or tr==7:
            for pr in "QRBN":
                promo=pr if white else pr.lower()
                out.append(Move(fr,fc,tr,tc,'P' if white else 'p',captured,Special.PROMO,promo))
        else:
            out.append(Move(fr,fc,tr,tc,'P' if white else 'p',captured,special,'.'))

    @staticmethod
    def _offset(out,b,r,c,white,offs):
        p=b[r][c]
        for dr,dc in offs:
            tr,tc=r+dr,c+dc
            if not Rules.in_board(tr,tc): continue
            tgt=b[tr][tc]
            if tgt is None or Rules.is_side(tgt,not white):
                out.append(Move(r,c,tr,tc,p,tgt if tgt is not None else '.',Special.NONE,'.'))

    @staticmethod
    def _slide(out,b,r,c,white,dirs):
        p=b[r][c]
        for dr,dc in dirs:
            tr,tc=r+dr,c+dc
            while Rules.in_board(tr,tc):
                tgt=b[tr][tc]
                if tgt is None:
                    out.append(Move(r,c,tr,tc,p,'.',Special.NONE,'.'))
                else:
                    if Rules.is_side(tgt,not white):
                        out.append(Move(r,c,tr,tc,p,tgt,Special.NONE,'.'))
                    break
                tr+=dr; tc+=dc

    @staticmethod
    def _castle(out,g,r,c,white):
        b=g.board
        if white:
            if r!=7 or c!=4: return
            if g.cwk and b[7][7]=='R' and b[7][5] is None and b[7][6] is None:
                if not Rules.attacked(b,7,4,False) and not Rules.attacked(b,7,5,False) and not Rules.attacked(b,7,6,False):
                    out.append(Move(7,4,7,6,'K','.',Special.CK,'.'))
            if g.cwq and b[7][0]=='R' and b[7][1] is None and b[7][2] is None and b[7][3] is None:
                if not Rules.attacked(b,7,4,False) and not Rules.attacked(b,7,3,False) and not Rules.attacked(b,7,2,False):
                    out.append(Move(7,4,7,2,'K','.',Special.CQ,'.'))
        else:
            if r!=0 or c!=4: return
            if g.cbk and b[0][7]=='r' and b[0][5] is None and b[0][6] is None:
                if not Rules.attacked(b,0,4,True) and not Rules.attacked(b,0,5,True) and not Rules.attacked(b,0,6,True):
                    out.append(Move(0,4,0,6,'k','.',Special.CK,'.'))
            if g.cbq and b[0][0]=='r' and b[0][1] is None and b[0][2] is None and b[0][3] is None:
                if not Rules.attacked(b,0,4,True) and not Rules.attacked(b,0,3,True) and not Rules.attacked(b,0,2,True):
                    out.append(Move(0,4,0,2,'k','.',Special.CQ,'.'))

    @staticmethod
    def gen_legal(g,r,c):
        legal=[]; pseudo=Rules.gen_pseudo(g,r,c)
        if not pseudo: return legal
        white=pseudo[0].piece.isupper()
        for m in pseudo:
            sim=g.clone_light(); Rules.apply(sim,m,False)
            kr,kc=Rules.find_king(sim.board,white)
            if not Rules.attacked(sim.board,kr,kc,not white):
                legal.append(m)
        return legal

    @staticmethod
    def gen_all(g):
        out=[]
        for r in range(8):
            for c in range(8):
                if Rules.is_side(g.board[r][c],g.white):
                    out.extend(Rules.gen_legal(g,r,c))
        return out

    @staticmethod
    def apply(g,m,record=True):
        b=g.board
        b[m.tr][m.tc]=m.piece; b[m.fr][m.fc]=None
        if m.special==Special.DOUBLE:
            g.epr=(m.fr+m.tr)//2; g.epc=m.fc
        elif m.special==Special.EP:
            capr=m.tr+1 if m.piece=='P' else m.tr-1
            b[capr][m.tc]=None
        elif m.special==Special.CK:
            b[m.fr][5]=b[m.fr][7]; b[m.fr][7]=None
        elif m.special==Special.CQ:
            b[m.fr][3]=b[m.fr][0]; b[m.fr][0]=None
        elif m.special==Special.PROMO:
            b[m.tr][m.tc]=m.promo
        if m.special!=Special.DOUBLE:
            g.epr=-1; g.epc=-1
        if m.piece=='K': g.cwk=g.cwq=False
        elif m.piece=='k': g.cbk=g.cbq=False
        if (m.fr==7 and m.fc==0) or (m.tr==7 and m.tc==0): g.cwq=False
        if (m.fr==7 and m.fc==7) or (m.tr==7 and m.tc==7): g.cwk=False
        if (m.fr==0 and m.fc==0) or (m.tr==0 and m.tc==0): g.cbq=False
        if (m.fr==0 and m.fc==7) or (m.tr==0 and m.tc==7): g.cbk=False
        if m.piece.upper()=='P' or m.captured!='.': g.hm=0
        else: g.hm+=1
        if not g.white: g.fm+=1
        g.white=not g.white
        if record:
            g.history.append(str(m)); g.keys.append(g.key())

    @staticmethod
    def find_king(b,white):
        k='K' if white else 'k'
        for i in range(8):
            for j in range(8):
                if b[i][j]==k: return i,j
        return -1,-1

    @staticmethod
    def in_check(g,white):
        kr,kc=Rules.find_king(g.board,white)
        if kr<0: return False
        return Rules.attacked(g.board,kr,kc,not white)

    @staticmethod
    def checkmate(g):
        return Rules.in_check(g,g.white) and len(Rules.gen_all(g))==0
    @staticmethod
    def stalemate(g):
        return (not Rules.in_check(g,g.white)) and len(Rules.gen_all(g))==0
    @staticmethod
    def fifty(g):
        return g.hm>=100

    @staticmethod
    def has_legal_ep(g):
        if g.epr<0: return False
        prank=g.epr+1 if g.white else g.epr-1
        if prank<0 or prank>7: return False
        pawn='P' if g.white else 'p'
        for dc in (-1,1):
            c=g.epc+dc
            if 0<=c<=7 and g.board[prank][c]==pawn:
                for m in Rules.gen_legal(g,prank,c):
                    if m.special==Special.EP: return True
        return False

    @staticmethod
    def threefold(g):
        if not g.keys: return False
        cur=g.keys[-1]; return g.keys.count(cur)>=3

    @staticmethod
    def insufficient(g):
        white=[]; black=[]
        for r in range(8):
            for c in range(8):
                p=g.board[r][c]
                if p is None or p.upper()=='K': continue
                up=p.upper()
                if up in ('P','R','Q'): return False
                (white if p.isupper() else black).append((p,r,c))
        total=len(white)+len(black)
        if total==0 or total==1: return True
        if total==2:
            if len(white)==1 and len(black)==1: return True
            side=white if len(white)==2 else black
            a,b=side[0][0].upper(),side[1][0].upper()
            if a=='B' and b=='B':
                c0=(side[0][1]+side[0][2])%2; c1=(side[1][1]+side[1][2])%2
                return c0==c1
            if a=='N' and b=='N': return True
            return False
        return False

class AI:
    MATE=900000; INF=1000000
    PV={0:0,1:100,2:320,3:330,4:500,5:900,6:0}
    PP=[0,0,0,0,0,0,0,0,50,50,50,50,50,50,50,50,10,10,20,30,30,20,10,10,5,5,10,25,25,10,5,5,0,0,0,20,20,0,0,0,5,-5,-10,0,0,-10,-5,5,5,10,10,-20,-20,10,10,5,0,0,0,0,0,0,0]
    PN=[-50,-40,-30,-30,-30,-30,-40,-50,-40,-20,0,0,0,0,-20,-40,-30,0,10,15,15,10,0,-30,-30,5,15,20,20,15,5,-30,-30,0,15,20,20,15,0,-30,-30,5,10,15,15,10,5,-30,-40,-20,0,5,5,0,-20,-40,-50,-40,-30,-30,-30,-30,-40,-50]
    PB=[-20,-10,-10,-10,-10,-10,-10,-20,-10,0,0,0,0,0,0,-10,-10,0,5,10,10,5,0,-10,-10,5,5,10,10,5,5,-10,-10,0,10,10,10,10,0,-10,-10,10,10,10,10,10,10,-10,-10,5,0,0,0,0,5,-10,-20,-10,-10,-10,-10,-10,-10,-20]
    PR=[0,0,0,0,0,0,0,0,5,10,10,10,10,10,10,5,-5,0,0,0,0,0,0,-5,-5,0,0,0,0,0,0,-5,-5,0,0,0,0,0,0,-5,-5,0,0,0,0,0,0,-5,-5,0,0,0,0,0,0,-5,0,0,0,5,5,0,0,0]
    PQ=[-20,-10,-10,-5,-5,-10,-10,-20,-10,0,0,0,0,0,0,-10,-10,0,5,5,5,5,0,-10,-5,0,5,5,5,5,0,-5,0,0,5,5,5,5,0,-5,-10,5,5,5,5,5,0,-10,-10,0,5,0,0,0,0,-10,-20,-10,-10,-5,-5,-10,-10,-20]
    PK=[-30,-40,-40,-50,-50,-40,-40,-30,-30,-40,-40,-50,-50,-40,-40,-30,-30,-40,-40,-50,-50,-40,-40,-30,-30,-40,-40,-50,-50,-40,-40,-30,-20,-30,-30,-40,-40,-30,-30,-20,-10,-20,-20,-20,-20,-20,-20,-10,20,20,0,0,0,0,20,20,20,30,10,0,0,10,30,20]
    @staticmethod
    def pidx(p):
        return {'P':1,'N':2,'B':3,'R':4,'Q':5,'K':6}.get(p.upper(),0)
    @staticmethod
    def pst(idx,pos):
        return [None,AI.PP,AI.PN,AI.PB,AI.PR,AI.PQ,AI.PK][idx][pos]
    @staticmethod
    def evaluate(g):
        score=0; b=g.board
        for r in range(8):
            for c in range(8):
                p=b[r][c]
                if p is None: continue
                idx=AI.pidx(p); pos=r*8+c
                if p.isupper(): score+=AI.PV[idx]+AI.pst(idx,pos)
                else: score-=AI.PV[idx]+AI.pst(idx,(7-r)*8+c)
        return score
    @staticmethod
    def side_score(g):
        s=AI.evaluate(g); return s if g.white else -s
    @staticmethod
    def order_score(m):
        if m.captured=='.': return 0
        return AI.PV[AI.pidx(m.captured)]*10-AI.PV[AI.pidx(m.piece)]
    @staticmethod
    def order(moves):
        moves.sort(key=AI.order_score,reverse=True)
    @staticmethod
    def quiesce(g,alpha,beta,qd):
        stand=AI.side_score(g)
        if stand>=beta: return beta
        if stand>alpha: alpha=stand
        if qd>=4: return alpha
        caps=[m for m in Rules.gen_all(g) if m.captured!='.']
        AI.order(caps)
        for m in caps:
            child=g.clone_light(); Rules.apply(child,m,False)
            sc=-AI.quiesce(child,-beta,-alpha,qd+1)
            if sc>=beta: return beta
            if sc>alpha: alpha=sc
        return alpha
    @staticmethod
    def negamax(g,depth,alpha,beta,ply):
        moves=Rules.gen_all(g)
        if not moves:
            if Rules.in_check(g,g.white): return -AI.MATE+ply
            return 0
        if depth<=0: return AI.quiesce(g,alpha,beta,0)
        AI.order(moves)
        best=-AI.INF
        for m in moves:
            child=g.clone_light(); Rules.apply(child,m,False)
            sc=-AI.negamax(child,depth-1,-beta,-alpha,ply+1)
            if sc>best: best=sc
            if best>alpha: alpha=best
            if alpha>=beta: break
        return best
    @staticmethod
    def best(g,depth):
        moves=Rules.gen_all(g)
        if not moves: return None
        if len(moves)==1: return moves[0]
        AI.order(moves)
        bm=moves[0]; bs=-AI.INF; alpha=-AI.INF; beta=AI.INF
        for m in moves:
            child=g.clone_light(); Rules.apply(child,m,False)
            sc=-AI.negamax(child,depth-1,-beta,-alpha,1)
            if sc>bs: bs=sc; bm=m
            if sc>alpha: alpha=sc
        return bm

# ---------------- 测试 ----------------
passn=0; failn=0
def check(name,cond):
    global passn,failn
    if cond: passn+=1; print("[PASS]",name)
    else: failn+=1; print("[FAIL]",name)

def empty(g):
    for r in range(8):
        for c in range(8): g.board[r][c]=None
    g.cwk=g.cwq=g.cbk=g.cbq=False; g.epr=g.epc=-1; g.hm=0; g.fm=1
    g.history=[]; g.keys=[]; g.keys.append(g.key())

def find_move(g,r,c,tr,tc):
    for m in Rules.gen_legal(g,r,c):
        if m.tr==tr and m.tc==tc: return m
    raise RuntimeError("no move")

def play(g,r,c,tr,tc):
    m=find_move(g,r,c,tr,tc); s=g.clone(); Rules.apply(s,m); return s

def t_init():
    g=GameState()
    check("初始局面白方合法走法数 = 20", len(Rules.gen_all(g))==20)
    check("初始局面 b1 马走法数 = 2", len(Rules.gen_legal(g,7,1))==2)
    check("初始局面 g1 马走法数 = 2", len(Rules.gen_legal(g,7,6))==2)
    check("初始局面 e2 兵走法数 = 2", len(Rules.gen_legal(g,6,4))==2)
    check("初始局面 d1 后走法数 = 0", len(Rules.gen_legal(g,7,3))==0)
    check("初始局面白王不被将军", not Rules.in_check(g,True))
    check("初始局面黑王不被将军", not Rules.in_check(g,False))
    check("初始局面非将死", not Rules.checkmate(g))
    b=GameState(); b.white=False
    check("初始局面黑方合法走法数 = 20", len(Rules.gen_all(b))==20)

def t_attack():
    g=GameState(); empty(g)
    g.board[4][4]='P'; g.board[3][4]='p'; g.board[7][4]='K'; g.board[0][4]='k'
    check("白兵 e4 攻击 d5", Rules.attacked(g.board,3,3,True))
    check("白兵 e4 攻击 f5", Rules.attacked(g.board,3,5,True))
    check("白兵 e4 不攻击 e5", not Rules.attacked(g.board,3,4,True))
    check("黑兵 e5 攻击 d4", Rules.attacked(g.board,4,3,False))
    check("黑兵 e5 攻击 f4", Rules.attacked(g.board,4,5,False))
    check("a1 不被攻击", not Rules.attacked(g.board,7,0,True) and not Rules.attacked(g.board,7,0,False))
    check("白王 e1 攻击 e2", Rules.attacked(g.board,6,4,True))

def t_ep():
    g=GameState(); g=play(g,6,4,4,4)
    check("e4 双进兵过路兵格(5,4)", g.epr==5 and g.epc==4)
    check("双进兵半步=0", g.hm==0)
    check("e4 后轮黑", not g.white)
    t=GameState(); empty(t)
    t.board[3][4]='P'; t.board[1][3]='p'; t.white=False
    t=play(t,1,3,3,3)
    check("黑 d5 双进后轮白", t.white)
    pm=Rules.gen_legal(t,3,4); ep=[m for m in pm if m.special==Special.EP]
    check("白 e5 存在吃过路兵", len(ep)>0)
    after=t.clone(); Rules.apply(after,ep[0])
    check("过路兵吃后白兵位于 d6", after.board[2][3]=='P')
    check("过路兵吃后黑 d5 移除", after.board[3][3] is None)
    check("过路兵吃后 ep 清空", after.epr==-1)

def t_castle():
    g=GameState(); empty(g)
    g.board[7][4]='K'; g.board[7][7]='R'; g.board[7][0]='R'; g.board[0][4]='k'
    g.cwk=g.cwq=g.cbk=g.cbq=True
    km=Rules.gen_legal(g,7,4)
    ck=any(m.special==Special.CK for m in km); cq=any(m.special==Special.CQ for m in km)
    check("白王可短易位", ck); check("白王可长易位", cq)
    mv=[m for m in km if m.special==Special.CK][0]
    after=g.clone(); Rules.apply(after,mv)
    check("短易位后王 g1", after.board[7][6]=='K')
    check("短易位后车 f1", after.board[7][5]=='R')
    check("短易位后 h1 空", after.board[7][7] is None)
    check("短易位后失易位权", not after.cwk and not after.cwq)
    blocked=g.clone(); blocked.board[3][3]='r'
    cqb=any(m.special==Special.CQ for m in Rules.gen_legal(blocked,7,4))
    check("d1 被攻击长易位禁", not cqb)
    ic=g.clone(); ic.board[3][4]='r'
    anyc=any(m.special in (Special.CK,Special.CQ) for m in Rules.gen_legal(ic,7,4))
    check("王被将军禁易位", not anyc)

def t_promo():
    g=GameState(); empty(g)
    g.board[1][4]='P'; g.board[7][4]='K'; g.board[0][7]='k'
    ms=Rules.gen_legal(g,1,4); pc=sum(1 for m in ms if m.special==Special.PROMO)
    check("e7 升变4种", pc==4)
    mv=[m for m in ms if m.special==Special.PROMO and m.promo=='Q'][0]
    after=g.clone(); Rules.apply(after,mv)
    check("升后 e8=Q", after.board[0][4]=='Q')
    check("升后 e7 空", after.board[1][4] is None)

def t_scholar():
    g=GameState()
    g=play(g,6,4,4,4); g=play(g,1,4,3,4); g=play(g,7,5,4,2)
    g=play(g,0,1,2,2); g=play(g,7,3,3,7); g=play(g,0,6,2,5); g=play(g,3,7,1,5)
    check("学者杀将军", Rules.in_check(g,False))
    check("学者杀将死", Rules.checkmate(g))
    check("学者杀非逼和", not Rules.stalemate(g))
    check("学者杀后轮黑", not g.white)

def t_fool():
    g=GameState()
    g=play(g,6,5,5,5); g=play(g,1,4,3,4); g=play(g,6,6,4,6); g=play(g,0,3,4,7)
    check("愚兄杀将军", Rules.in_check(g,True))
    check("愚兄杀将死", Rules.checkmate(g))

def t_stale():
    g=GameState(); empty(g)
    g.board[0][7]='k'; g.board[1][5]='Q'; g.board[2][6]='K'; g.white=False
    check("逼和未将军", not Rules.in_check(g,False))
    check("逼和走法=0", len(Rules.gen_all(g))==0)
    check("逼和判和", Rules.stalemate(g))
    check("逼和非将死", not Rules.checkmate(g))

def t_insuff():
    g=GameState(); empty(g); g.board[7][4]='K'; g.board[0][4]='k'
    check("双王和", Rules.insufficient(g))
    g.board[4][4]='N'; check("K+N和", Rules.insufficient(g))
    g.board[4][4]='b'; check("K+B和", Rules.insufficient(g))
    g.board[4][4]='P'; check("K+P不和", not Rules.insufficient(g))
    g.board[4][4]='R'; check("K+R不和", not Rules.insufficient(g))
    check("初始非和", not Rules.insufficient(GameState()))

def t_fifty():
    g=GameState()
    g=play(g,7,6,5,5); check("马1步半步=1", g.hm==1)
    g=play(g,0,6,2,5); check("2步半步=2", g.hm==2)
    g=play(g,5,5,7,6); check("3步半步=3", g.hm==3)
    g=play(g,2,5,0,6); check("4步半步=4", g.hm==4)
    g=play(g,6,4,4,4); check("动兵清零", g.hm==0)
    check("未达100不判", not Rules.fifty(g))
    f=GameState(); f.hm=100; check("100判和", Rules.fifty(f))

def t_three():
    g=GameState()
    g=play(g,7,6,5,5); g=play(g,0,6,2,5); g=play(g,5,5,7,6); g=play(g,2,5,0,6)
    check("4步不判", not Rules.threefold(g))
    g=play(g,7,6,5,5); g=play(g,0,6,2,5); g=play(g,5,5,7,6); g=play(g,2,5,0,6)
    check("8步判和", Rules.threefold(g))
    g=play(g,6,4,4,4); check("新局不判", not Rules.threefold(g))

def t_eval():
    g=GameState(); check("初始评估=0", AI.evaluate(g)==0)
    g.board[4][4]='P'; check("多兵正", AI.evaluate(g)>0)
    g.board[3][3]='n'; check("多马负", AI.evaluate(g)<0)

def t_term():
    g=GameState()
    g=play(g,6,4,4,4); g=play(g,1,4,3,4); g=play(g,7,5,4,2); g=play(g,0,1,2,2)
    g=play(g,7,3,3,7); g=play(g,0,6,2,5); g=play(g,3,7,1,5)
    ms=AI.negamax(g,2,-AI.INF,AI.INF,0); check("将死大负", ms<=-9000)
    st=GameState(); empty(st); st.board[0][7]='k'; st.board[1][5]='Q'; st.board[2][6]='K'; st.white=False
    st.keys=[]; st.keys.append(st.key())
    check("逼和=0", AI.negamax(st,2,-AI.INF,AI.INF,0)==0)

def t_mate():
    g=GameState(); empty(g)
    g.board[2][1]='K'; g.board[7][7]='Q'; g.board[0][0]='k'; g.white=True
    g.keys=[]; g.keys.append(g.key())
    bm=AI.best(g,2); after=g.clone(); Rules.apply(after,bm)
    check("AI一步杀", Rules.checkmate(after))

def t_freeq():
    g=GameState(); empty(g)
    g.board[7][3]='Q'; g.board[7][4]='K'; g.board[0][3]='q'; g.board[0][7]='k'; g.white=True
    g.keys=[]; g.keys.append(g.key())
    bm=AI.best(g,2)
    check("AI吃无保护后", bm and bm.tr==0 and bm.tc==3 and bm.captured=='q')

def t_open():
    import time
    g=GameState(); t0=time.time(); bm=AI.best(g,2); dt=time.time()-t0
    legal=any(m.fr==bm.fr and m.fc==bm.fc and m.tr==bm.tr and m.tc==bm.tc for m in Rules.gen_all(g))
    check("开局合法", legal); check("深度2<5s", dt<5)

def t_pinned():
    g=GameState(); empty(g)
    g.board[7][3]='K'; g.board[6][3]='B'; g.board[0][3]='r'; g.board[0][4]='k'
    check("钉死前伪合法>0", len(Rules.gen_pseudo(g,6,3))>0)
    check("钉死后无合法", len(Rules.gen_legal(g,6,3))==0)
    check("钉死局面未将军", not Rules.in_check(g,True))

def t_evade():
    g=GameState(); empty(g)
    g.board[7][4]='K'; g.board[0][4]='r'; g.board[0][0]='k'
    check("逃将被将军", Rules.in_check(g,True))
    legal=Rules.gen_all(g); check("逃着>0", len(legal)>0)
    ok=all((lambda m: (lambda a: not Rules.in_check(a,True))(play(g,m.fr,m.fc,m.tr,m.tc)))(m) for m in legal)
    check("每步解除将军", ok)

def t_epreveal():
    g=GameState(); empty(g)
    g.board[3][0]='K'; g.board[3][7]='r'; g.board[3][3]='P'; g.board[3][4]='p'; g.white=True
    g.epr=2; g.epc=4; g.keys=[]
    check("EP揭将当前未将军", not Rules.in_check(g,True))
    legal=Rules.gen_legal(g,3,3); hasep=any(m.special==Special.EP for m in legal)
    check("EP揭将不出现", not hasep)

def t_insuff_ext():
    g=GameState(); empty(g); g.board[7][4]='K'; g.board[0][4]='k'
    check("KK和", Rules.insufficient(g))
    g.board[7][1]='N'; check("KN和", Rules.insufficient(g))
    g.board[7][2]='N'; check("KNN和", Rules.insufficient(g))
    kb=GameState(); empty(kb); kb.board[7][4]='K'; kb.board[0][4]='k'; kb.board[7][2]='B'; kb.board[0][3]='b'
    check("KB vs KB和", Rules.insufficient(kb))
    kbb=GameState(); empty(kbb); kbb.board[7][4]='K'; kbb.board[0][4]='k'; kbb.board[7][2]='B'; kbb.board[7][5]='B'
    check("KBB异色可杀不和", not Rules.insufficient(kbb))
    kbn=GameState(); empty(kbn); kbn.board[7][4]='K'; kbn.board[0][4]='k'; kbn.board[7][2]='B'; kbn.board[7][1]='N'
    check("KBN可杀不和", not Rules.insufficient(kbn))
    kr=GameState(); empty(kr); kr.board[7][4]='K'; kr.board[0][4]='k'; kr.board[7][0]='R'
    check("K+R不和", not Rules.insufficient(kr))

def t_d3():
    import time
    g=GameState()
    g=play(g,6,4,4,4); g=play(g,1,4,3,4); g=play(g,7,6,5,5); g=play(g,0,1,2,2)
    g=play(g,7,5,4,2); g=play(g,0,6,2,5)
    t0=time.time(); bm=AI.best(g,3); dt=time.time()-t0
    legal=any(m.fr==bm.fr and m.fc==bm.fc and m.tr==bm.tr and m.tc==bm.tc for m in Rules.gen_all(g))
    check("深度3合法", legal); check("深度3<2s", dt<2)

def t_rookcap():
    g=GameState(); empty(g)
    g.board[7][4]='K'; g.board[7][7]='R'; g.board[0][7]='r'; g.board[0][4]='k'; g.white=False
    g.cwk=g.cwq=g.cbk=g.cbq=True
    mv=[m for m in Rules.gen_legal(g,0,7) if m.tr==7 and m.tc==7]
    check("黑车吃白车", len(mv)>0)
    after=g.clone(); Rules.apply(after,mv[0])
    check("失短易位权", not after.cwk); check("黑车占h1", after.board[7][7]=='r')

def t_degen():
    e=GameState(); empty(e)
    check("空盘a1不攻击", not Rules.attacked(e.board,7,0,True) and not Rules.attacked(e.board,7,0,False))
    check("空盘e4不攻击", not Rules.attacked(e.board,4,4,True) and not Rules.attacked(e.board,4,4,False))
    kk=GameState(); empty(kk); kk.board[7][4]='K'; kk.board[0][4]='k'
    check("KvK有值", AI.best(kk,1) is not None)
    mt=GameState()
    mt=play(mt,6,4,4,4); mt=play(mt,1,4,3,4); mt=play(mt,7,5,4,2); mt=play(mt,0,1,2,2)
    mt=play(mt,7,3,3,7); mt=play(mt,0,6,2,5); mt=play(mt,3,7,1,5)
    check("将死无值", AI.best(mt,1) is None)

def t_san():
    g=GameState(); empty(g); g.board[1][4]='P'; g.board[7][4]='K'; g.board[0][7]='k'
    qm=[m for m in Rules.gen_legal(g,1,4) if m.special==Special.PROMO and m.promo=='Q']
    check("升后存在", len(qm)>0)
    if qm:
        check("SAN含=Q", '=Q' in str(qm[0])); check("SAN=e8=Q", str(qm[0])=='e8=Q')

if __name__=="__main__":
    t_init(); t_attack(); t_ep(); t_castle(); t_promo(); t_scholar(); t_fool()
    t_stale(); t_insuff(); t_fifty(); t_three(); t_eval(); t_term(); t_mate()
    t_freeq(); t_open(); t_pinned(); t_evade(); t_epreveal(); t_insuff_ext()
    t_d3(); t_rookcap(); t_degen(); t_san()
    print("\n========================================")
    print(f"RESULT: {passn} passed, {failn} failed")
    print("========================================")
