# Builds src/data/kdst.json (kickers and defenses for 17-0).
#   python3 scripts/build-kdst.py <folder> src/data/kdst.json
# <folder> holds nflverse stats_player_reg_<y>.csv as preg_<y>.csv and stats_team_reg_<y>.csv as treg_<y>.csv (1999 on),
# nflverse/nfldata games.csv, and FiveThirtyEight nfl-elo-game nfl_games.csv saved as g538.csv (scores back to 1970).
import csv, json, sys, collections, statistics
D=sys.argv[1]; OUT=sys.argv[2]
n=lambda v:float(v) if v not in ('',None,'NA') else 0.0
FIX={'LA':'LAR','STL':'LAR','OAK':'LV','SD':'LAC','WSH':'WAS','JAC':'JAX'}
fx=lambda t:FIX.get(t,t)
def sg(y): return 14 if y<=1977 else 9 if y==1982 else 15 if y==1987 else 16 if y<=2020 else 17
def tier(pa): return 10 if pa==0 else 7 if pa<=6 else 4 if pa<=13 else 1 if pa<=20 else 0 if pa<=27 else -1 if pa<=34 else -4
# per-game points scored/allowed
games=collections.defaultdict(list)   # (y,team) -> [(pf,pa)]
for r in csv.DictReader(open(f'{D}/g538.csv')):
  y=int(r['season'])
  if y<1970 or y>1998 or r['playoff'] not in ('0',''): continue
  a,b=fx(r['team1']),fx(r['team2']); s1,s2=int(r['score1']),int(r['score2'])
  games[(y,a)].append((s1,s2)); games[(y,b)].append((s2,s1))
for r in csv.DictReader(open(f'{D}/games.csv')):
  y=int(r['season'])
  if y<1999 or r['game_type']!='REG' or not r['home_score']: continue
  h,a=fx(r['home_team']),fx(r['away_team']); hs,as_=int(r['home_score']),int(r['away_score'])
  games[(y,h)].append((hs,as_)); games[(y,a)].append((as_,hs))
k={}; dst={}
ratios=[]; extra=[]
for y in range(1999,2026):
  kick=collections.defaultdict(list)
  for r in csv.DictReader(open(f'{D}/preg_{y}.csv')):
    if r['position']!='K': continue
    pts=3*(n(r['fg_made_0_19'])+n(r['fg_made_20_29'])+n(r['fg_made_30_39']))+4*n(r['fg_made_40_49'])+5*(n(r['fg_made_50_59'])+n(r['fg_made_60_']))+n(r['pat_made'])-n(r['fg_missed'])-n(r['pat_missed'])
    t=fx(r['recent_team']); g=int(n(r['games']))
    if g<1: continue
    kick[t].append([r['player_display_name'],g,round(pts,1),int(n(r['fg_made'])),int(n(r['fg_att'])),int(n(r['pat_made']))])
  for t,lst in kick.items():
    lst.sort(key=lambda x:-x[2]); k.setdefault(str(y),{})[t]=lst[:2]
    pf=sum(p for p,_ in games[(y,t)])
    if pf and y<=2008: ratios.append(sum(x[2] for x in lst)/pf)
  for r in csv.DictReader(open(f'{D}/treg_{y}.csv')):
    t=fx(r['team']); gl=games[(y,t)]
    if not gl: continue
    sacks=n(r['def_sacks']); ints=n(r['def_interceptions']); fr=n(r['fumble_recovery_opp']); tds=n(r['def_tds'])+n(r['special_teams_tds']); saf=n(r['def_safeties'])
    pa_pts=sum(tier(pa) for _,pa in gl); other=sacks+2*ints+2*fr+6*tds+2*saf
    if y<=2005: extra.append(other/len(gl))
    dst.setdefault(str(y),{})[t]=[len(gl),round(pa_pts+other,1),int(sacks),int(ints),int(fr),int(tds),round(sum(pa for _,pa in gl)/len(gl),1),0]
R=statistics.mean(ratios); X=statistics.mean(extra)
print('kicker share of team points %.3f, takeaway/sack pts per game %.2f'%(R,X))
for y in range(1970,1999):
  for (yy,t),gl in games.items():
    if yy!=y: continue
    pf=sum(p for p,_ in gl); g=len(gl)
    k.setdefault(str(y),{})[t]=[['~kicker',g,round(R*pf,1),0,0,0]]
    dst.setdefault(str(y),{})[t]=[g,round(sum(tier(pa) for _,pa in gl)+X*g,1),0,0,0,0,round(sum(pa for _,pa in gl)/g,1),1]
json.dump({'built':'2026-11-03','note':'Kickers and defenses. 1999 on: real stats (nflverse player and team stats, nflverse/nfldata scores). 1970-1998: estimated from real game scores (FiveThirtyEight), kicker = share of team points, defense = points-allowed tiers plus an era-average for sacks and takeaways.',
 'dstCols':['g','pts','sacks','ints','fr','tds','paPerGame','estimated'],'kCols':['name','g','pts','fgm','fga','xpm'],'k':k,'dst':dst},open(OUT,'w'),separators=(',',':'))
print('years',len(k),len(dst))
