"""매주 엑셀 과제 만들기 (가상 운영 데이터 + 숨은 원인).

열린 과제: 숫자 문제 없이 "평소와 다른 점을 찾아 팀장님께 보고하기" 하나만 낸다.
어디를 볼지 스스로 찾는 것이 연습의 핵심이라, 문제로 길을 나눠 주지 않는다.

사용법 (저장소 맨 위에서):
    python scripts/make_excel.py                 # 이번 주 월요일(한국 시간) 과제
    python scripts/make_excel.py --week 2026-11-16 [--force]

만드는 파일:
    excel/<주>_엑셀과제.xlsx       상황 · 데이터 · 보고서 · 힌트 시트
    data/excel/<주>.json           보드가 읽는 과제 정보 (숨은 원인·근거 수치는 reveal에 base64)
    data/excel/index.json          주차 목록

같은 주는 같은 데이터가 나오도록 주 문자열로 난수를 고정한다.
"""
import argparse
import base64
import json
import random
import re
from datetime import date, datetime, timedelta, timezone
from decimal import ROUND_HALF_UP, Decimal
from pathlib import Path

from openpyxl import Workbook
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter

ROOT = Path(__file__).resolve().parent.parent
GAMES = [
    ("별빛항로", "수집형 RPG", "별조각"),
    ("검은바다 연대기", "MMORPG", "진주"),
    ("코드네임: 폭풍전선", "FPS", "크레딧"),
    ("룬스톤 아레나", "AOS", "룬 조각"),
    ("그린필드 매니저", "축구 매니지먼트", "G코인"),
    ("드롭존 서바이벌", "배틀로얄", "드롭 코인"),
    ("느긋한 용사 키우기", "방치형 RPG", "보석"),
]
WD = ["월", "화", "수", "목", "금", "토", "일"]
HEAD_FILL = PatternFill("solid", fgColor="A9C6EE")
ANS_FILL = PatternFill("solid", fgColor="FFF2CC")
PROMPT = "데이터를 살펴보고 평소와 다른 점을 찾아 팀장님께 보고하세요. 숫자 근거를 함께 적으세요."
REPORT = [
    ("한 줄 요약", "팀장님이 이 줄만 읽어도 알 수 있게"),
    ("이상 징후", "언제, 무엇이 평소와 달랐는지"),
    ("숫자 근거", "근거 수치 2~3개 (평소와 비교해서)"),
    ("원인 추정", "확인한 사실과 추측을 나눠서"),
    ("다음 조치", "누가 무엇을 확인·처리하면 좋을지"),
]
HINTS = [
    "1. 먼저 날짜별로 나눠 보세요. 평소와 크게 다른 날이 있나요?",
    "2. 그날만 골라 더 잘게 나눠 보세요. 시간대, 유형·상품·사유, 상태 같은 열이 있어요.",
    "3. 다른 날의 같은 부분과 비교해 보세요. '평소 대비 몇 배'처럼 적으면 근거가 분명해져요.",
    "4. 데이터로 확인한 것과 내 추측은 나눠서 적으세요.",
    "도구는 자유예요. 필터, 피벗 테이블, 함수(COUNTIFS 등), 차트 중 편한 것을 쓰세요.",
]


def norm(s):
    t = re.sub(r"[\s,명건원%회개분]", "", str(s))
    if re.fullmatch(r"-?\d+(\.\d+)?", t):
        d = Decimal(t)
        if d == d.to_integral_value():
            return str(int(d))
        r = d.quantize(Decimal("0.1"), rounding=ROUND_HALF_UP)
        return str(int(r)) if r == r.to_integral_value() else format(r, "f")
    return t


def pct(a, b):
    return norm(Decimal(a * 100) / Decimal(b))


def md(d):
    return f"{d.month}/{d.day}({WD[d.weekday()]})"


def kst_monday():
    today = datetime.now(timezone(timedelta(hours=9))).date()
    return today - timedelta(days=today.weekday())


# ───────── 과제 종류 4가지 ─────────
def task_inquiry(rng, game, days):
    """문의 유형 집계: 하루 중 몇 시간 동안 버그 문의가 몰린다."""
    types = ["결제", "계정", "버그", "이벤트 보상", "신고", "기타"]
    weights = [22, 14, 16, 20, 18, 10]
    bad_day = rng.randrange(7)
    h0 = rng.randrange(10, 19)
    rows, n = [], 0
    for i, d in enumerate(days):
        for _ in range(rng.randint(150, 220)):
            h = rng.choices(range(24), weights=[1, 1, 1, 1, 1, 1, 2, 3, 4, 5, 6, 7, 7, 7, 7, 7, 7, 8, 9, 10, 10, 9, 6, 3])[0]
            t = rng.choices(types, weights)[0]
            rows.append([d, h, rng.randrange(60), t])
        if i == bad_day:
            for _ in range(rng.randint(70, 100)):
                rows.append([d, rng.randrange(h0, h0 + 3), rng.randrange(60), "버그"])
    rows.sort(key=lambda r: (r[0], r[1], r[2]))
    out = []
    for d, h, m, t in rows:
        n += 1
        spike = d == days[bad_day] and h0 <= h < h0 + 3 and t == "버그"
        status = "대기" if (spike and rng.random() < 0.55) or rng.random() < 0.06 else "완료"
        mins = rng.randint(25, 90) if spike else rng.randint(3, 30)
        out.append([f"T{n:06d}", d, f"{h:02d}:{m:02d}", h, t, status, mins])
    bug = [r for r in out if r[4] == "버그"]
    per_day = {d: sum(1 for r in bug if r[1] == d) for d in days}
    top = max(days, key=lambda d: per_day[d])
    others = [per_day[d] for d in days if d != top]
    in_win = sum(1 for r in bug if r[1] == top and h0 <= r[3] < h0 + 3)
    return {
        "type": "문의 유형 집계",
        "title": "지난주 CS 문의 유형 보고",
        "situation": f"지난주 CS 문의 기록이에요. 팀장님이 유형별 문의 현황과 특이 사항을 월요일 회의 전까지 정리해 달라고 했어요.",
        "story": f"당신은 {game[0]} 운영팀 신입입니다. 지난주({md(days[0])}~{md(days[-1])}) 고객 문의 기록이 아래 '데이터' 시트에 있습니다. 팀장님이 '유형별 문의 건수와 특이 사항을 월요일 회의 전까지 정리해 주세요'라고 요청했습니다.",
        "headers": ["문의 번호", "날짜", "접수 시각", "시간대(시)", "문의 유형", "처리 상태", "처리 시간(분)"],
        "widths": [12, 12, 10, 10, 12, 10, 13],
        "rows": out,
        "cause": f"{md(top)} {h0}~{h0 + 3}시에 업데이트 직후 클라이언트 오류가 생겨 버그 문의가 몰렸어요.",
        "evidence": [f"{md(top)} 버그 문의 {per_day[top]}건 (다른 날 평균 {round(sum(others) / len(others))}건)", f"그날 버그 문의 중 {in_win}건이 {h0}~{h0 + 3}시에 접수", "같은 시간대 '대기' 상태와 긴 처리 시간이 몰려 있음"],
    }


def task_event(rng, game, days):
    """이벤트 성과: 하루 14~18시 보상 서버 오류로 보상 미지급."""
    users = [f"U{n:05d}" for n in rng.sample(range(1, 99999), 420)]
    loyalty = {u: rng.uniform(0.35, 0.95) for u in users}
    bad_day = rng.randrange(7)
    out = []
    for i, d in enumerate(days):
        for u in users:
            if rng.random() > loyalty[u]:
                continue
            h = rng.choices(range(24), weights=[2, 1, 1, 1, 1, 1, 1, 2, 3, 4, 5, 6, 7, 7, 7, 7, 7, 8, 9, 10, 10, 9, 7, 4])[0]
            m = rng.randrange(60)
            got = "Y"
            if i == bad_day and 14 <= h < 18:
                got = "N" if rng.random() < 0.97 else "Y"
            elif rng.random() < 0.015:
                got = "N"
            out.append([u, d, f"{h:02d}:{m:02d}", h, "Y", got])
    out.sort(key=lambda r: (r[1], r[2], r[0]))
    rate = {d: (sum(1 for r in out if r[1] == d and r[5] == "Y"), sum(1 for r in out if r[1] == d)) for d in days}
    low = min(days, key=lambda d: rate[d][0] / rate[d][1])
    in_win = sum(1 for r in out if r[1] == low and r[5] == "N" and 14 <= r[3] < 18)
    return {
        "type": "이벤트 성과",
        "title": "지난주 출석 이벤트 참여 현황 보고",
        "situation": "지난주 7일 출석 이벤트의 접속·보상 수령 기록이에요. 팀장님이 참여 현황과 보상 지급에 문제가 없었는지 보고해 달라고 했어요.",
        "story": f"당신은 {game[0]} 운영팀 신입입니다. 지난주({md(days[0])}~{md(days[-1])}) 진행한 7일 출석 이벤트 기록이 '데이터' 시트에 있습니다. 팀장님이 '참여 현황과 보상 지급에 문제가 없었는지 월요일 회의 전까지 보고해 주세요'라고 요청했습니다.",
        "headers": ["유저 ID", "날짜", "접속 시각", "시간대(시)", "출석", "보상 수령"],
        "widths": [10, 12, 10, 10, 8, 10],
        "rows": out,
        "cause": f"{md(low)} 14~18시에 보상 서버 오류가 나서 그 시간에 접속한 유저에게 보상이 지급되지 않았어요.",
        "evidence": [f"{md(low)} 수령률 {pct(*rate[low])}% (다른 날은 98% 이상)", f"그날 N {in_win}건이 모두 14~18시 접속자", "다른 시간대 접속자는 정상 수령"],
    }


def task_sales(rng, game, days):
    """매출 일일 보고: 결제 장애(실패 급증) 또는 가격 설정 오류(특정 상품 급증)."""
    cur = game[2]
    products = [(f"{cur} 300개", 3300), (f"{cur} 1,200개", 12000), ("월정액", 5500), ("시즌 패스", 11000), ("성장 패키지", 33000), ("한정 스킨 상자", 22000)]
    weights = [30, 18, 20, 12, 6, 14]
    variant = rng.choice(["outage", "price"])
    bad_day = rng.randrange(7)
    h0 = rng.randrange(12, 20)
    out, n = [], 0
    for i, d in enumerate(days):
        cnt = rng.randint(170, 240)
        if variant == "price" and i == bad_day:
            cnt += 0
        lines = []
        for _ in range(cnt):
            h = rng.choices(range(24), weights=[2, 1, 1, 1, 1, 1, 1, 2, 3, 4, 5, 6, 7, 7, 7, 7, 7, 8, 9, 10, 10, 9, 7, 4])[0]
            p, price = rng.choices(products, weights)[0]
            lines.append([h, rng.randrange(60), p, price])
        if variant == "price" and i == bad_day:
            for _ in range(rng.randint(90, 130)):
                lines.append([rng.randrange(h0, h0 + 4), rng.randrange(60), "성장 패키지", 3300])
        lines.sort()
        for h, m, p, price in lines:
            n += 1
            fail = (variant == "outage" and i == bad_day and h0 <= h < h0 + 3 and rng.random() < 0.8) or rng.random() < 0.02
            out.append([f"P{n:06d}", d, f"{h:02d}:{m:02d}", h, p, price, "실패" if fail else "완료"])
    if variant == "outage":
        fails = {d: sum(1 for r in out if r[1] == d and r[6] == "실패") for d in days}
        top = max(days, key=lambda d: fails[d])
        cause = f"{md(top)} {h0}~{h0 + 3}시에 결제 서버 장애가 나서 결제가 대부분 실패했어요."
        ev = [f"{md(top)} 실패 {fails[top]}건 (다른 날은 하루 한 자릿수)", f"실패가 {h0}~{h0 + 3}시에 몰려 있음", "같은 시간대 상품 종류와 관계없이 실패"]
    else:
        sold = {d: sum(1 for r in out if r[1] == d and r[4] == "성장 패키지" and r[6] == "완료") for d in days}
        top = max(days, key=lambda d: sold[d])
        cause = f"{md(top)} {h0}시부터 약 4시간 동안 '성장 패키지' 가격이 33,000원이 아닌 3,300원으로 잘못 설정돼 판매가 몰렸어요."
        ev = [f"{md(top)} 성장 패키지 {sold[top]}건 판매 (평소 하루 10건 안팎)", "그날 성장 패키지 단가가 3,300원인 기록이 있음", f"{h0}~{h0 + 4}시에 몰림"]
    return {
        "type": "매출 일일 보고",
        "title": "지난주 상품별 매출 보고",
        "situation": "지난주 유료 상품 결제 기록이에요. 팀장님이 매출 합계와 특이 사항을 정리해 달라고 했어요.",
        "story": f"당신은 {game[0]} 운영팀 신입입니다. 지난주({md(days[0])}~{md(days[-1])}) 결제 기록이 '데이터' 시트에 있습니다. 팀장님이 '주간 매출과 이상한 점이 있었는지 월요일 회의 전까지 정리해 주세요'라고 요청했습니다.",
        "headers": ["주문 번호", "날짜", "결제 시각", "시간대(시)", "상품명", "단가(원)", "결제 상태"],
        "widths": [12, 12, 10, 10, 16, 11, 10],
        "rows": out,
        "money_col": 6,
        "cause": cause,
        "evidence": ev,
    }


def task_sanction(rng, game, days):
    """제재 현황: 안티치트 업데이트 오탐으로 하루 '불법 프로그램' 제재 급증, 이의 신청 후 해제."""
    reasons = ["불법 프로그램", "욕설", "비매너", "자산 이동"]
    rw = [20, 40, 30, 10]
    steps = {"불법 프로그램": ["7일", "영구"], "욕설": ["경고", "3일"], "비매너": ["경고", "3일"], "자산 이동": ["7일", "영구"]}
    bad_day = rng.randrange(7)
    out, n = [], 0
    for i, d in enumerate(days):
        items = [(rng.choices(reasons, rw)[0], False) for _ in range(rng.randint(140, 200))]
        if i == bad_day:
            items += [("불법 프로그램", True) for _ in range(rng.randint(80, 120))]
        for reason, false_pos in items:
            n += 1
            step = rng.choice(steps[reason])
            appeal = "Y" if (false_pos and rng.random() < 0.85) or rng.random() < 0.12 else "N"
            if appeal == "N":
                result = "-"
            elif false_pos:
                result = "해제"
            else:
                result = "해제" if rng.random() < 0.1 else "유지"
            out.append([f"S{n:06d}", f"U{rng.randrange(1, 99999):05d}", d, reason, step, appeal, result])
    per = {d: sum(1 for r in out if r[2] == d and r[3] == "불법 프로그램") for d in days}
    top = max(days, key=lambda d: per[d])
    lifted_top = sum(1 for r in out if r[2] == top and r[6] == "해제")
    return {
        "type": "제재 현황",
        "title": "지난주 제재 현황 보고",
        "situation": "지난주 제재 기록이에요. 팀장님이 사유별 제재 건수와 이의 신청 결과를 정리해 달라고 했어요.",
        "story": f"당신은 {game[0]} 운영팀 신입입니다. 지난주({md(days[0])}~{md(days[-1])}) 제재 기록이 '데이터' 시트에 있습니다. 팀장님이 '사유별 제재 현황과 이의 신청 결과에서 특이 사항을 월요일 회의 전까지 보고해 주세요'라고 요청했습니다.",
        "headers": ["제재 번호", "유저 ID", "날짜", "사유", "제재 단계", "이의 신청", "결과"],
        "widths": [12, 10, 12, 14, 10, 10, 8],
        "rows": out,
        "date_col": 3,
        "cause": f"{md(top)}에 안티치트 탐지 업데이트 오류로 정상 유저가 '불법 프로그램'으로 잘못 제재됐고, 이의 신청 후 대부분 해제됐어요.",
        "evidence": [f"{md(top)} 불법 프로그램 제재 {per[top]}건 (다른 날 하루 30~40건 수준)", f"그날 해제 {lifted_top}건으로 다른 날보다 훨씬 많음", "그날 제재 대부분이 이의 신청 Y"],
    }


TASKS = [task_inquiry, task_event, task_sales, task_sanction]


# ───────── 엑셀 파일 ─────────
def build_xlsx(t, game, week, path):
    wb = Workbook()
    ws = wb.active
    ws.title = "상황"
    ws.column_dimensions["A"].width = 100
    lines = [
        (f"[{t['type']}] {t['title']}", Font(bold=True, size=14)),
        (f"게임: {game[0]} ({game[1]}) · 과제 주: {week} · 이 데이터와 게임은 모두 가상이에요.", Font(color="687089")),
        ("", None),
        (t["story"], None),
        ("", None),
        ("할 일", Font(bold=True)),
        (PROMPT, None),
        ("1. '데이터' 시트를 자유롭게 분석하세요. 어디를 볼지는 직접 정해요.", None),
        ("2. '보고서' 시트의 노란 칸을 채우고, 같은 내용을 보드의 보고서 칸에 옮겨 적으세요.", None),
        ("3. 일요일에 AI 코치가 근거 수치가 맞는지, 숨은 원인을 찾았는지 봐요.", None),
        ("4. 막히면 마지막 '힌트' 시트를 열어 보세요. 답이 아니라 분석 순서만 적혀 있어요.", None),
    ]
    for i, (text, font) in enumerate(lines, 1):
        c = ws.cell(row=i, column=1, value=text)
        c.alignment = Alignment(wrap_text=True, vertical="top")
        if font:
            c.font = font

    ds = wb.create_sheet("데이터")
    ds.append(t["headers"])
    for c in ds[1]:
        c.font = Font(bold=True)
        c.fill = HEAD_FILL
    for r in t["rows"]:
        ds.append(r)
    for i, w in enumerate(t["widths"], 1):
        ds.column_dimensions[get_column_letter(i)].width = w
    dcol = t.get("date_col", 2)
    for row in ds.iter_rows(min_row=2, min_col=dcol, max_col=dcol):
        for c in row:
            c.number_format = "yyyy-mm-dd"
    if t.get("money_col"):
        for row in ds.iter_rows(min_row=2, min_col=t["money_col"], max_col=t["money_col"]):
            for c in row:
                c.number_format = "#,##0"
    ds.freeze_panes = "A2"
    ds.auto_filter.ref = ds.dimensions

    rs = wb.create_sheet("보고서")
    rs.column_dimensions["A"].width = 14
    rs.column_dimensions["B"].width = 34
    rs.column_dimensions["C"].width = 80
    rs.append(["보고서", f"{t['title']} ({week})"])
    rs["A1"].font = Font(bold=True)
    rs.append(["항목", "쓸 내용", "내 보고"])
    for c in rs[2]:
        c.font = Font(bold=True)
        c.fill = HEAD_FILL
    for i, (label, guide) in enumerate(REPORT, 3):
        rs.cell(row=i, column=1, value=label).font = Font(bold=True)
        rs.cell(row=i, column=2, value=guide).alignment = Alignment(wrap_text=True, vertical="top")
        c = rs.cell(row=i, column=3, value="")
        c.fill = ANS_FILL
        c.alignment = Alignment(wrap_text=True, vertical="top")
        rs.row_dimensions[i].height = 60

    hs = wb.create_sheet("힌트")
    hs.column_dimensions["A"].width = 100
    hs.append(["힌트 (막힐 때만 보세요)"])
    hs["A1"].font = Font(bold=True)
    for h in HINTS:
        hs.append([h])
        hs.cell(row=hs.max_row, column=1).alignment = Alignment(wrap_text=True)
    path.parent.mkdir(parents=True, exist_ok=True)
    wb.save(path)


def make(week, force=False):
    wk = date.fromisoformat(week)
    if wk.weekday() != 0:
        raise SystemExit(f"{week}는 월요일이 아니에요.")
    xlsx = ROOT / "excel" / f"{week}_엑셀과제.xlsx"
    js = ROOT / "data" / "excel" / f"{week}.json"
    if js.exists() and xlsx.exists() and not force:
        print(f"{week}: 이미 있어요 (--force로 다시 만들기)")
        return
    rng = random.Random(week)
    iso = wk.isocalendar()[1]
    game = GAMES[iso % len(GAMES)]
    days = [wk - timedelta(days=7 - i) for i in range(7)]  # 지난주 월~일
    t = TASKS[iso % len(TASKS)](rng, game, days)
    build_xlsx(t, game, week, xlsx)

    reveal = {"cause": t["cause"], "evidence": t["evidence"]}
    info = {
        "week": week, "type": t["type"], "title": t["title"], "game": game[0],
        "situation": t["situation"], "file": f"excel/{week}_엑셀과제.xlsx",
        "rows": len(t["rows"]), "task": PROMPT,
        "report": [{"label": label, "guide": guide} for label, guide in REPORT],
        "reveal": base64.b64encode(json.dumps(reveal, ensure_ascii=False).encode("utf-8")).decode("ascii"),
    }
    js.parent.mkdir(parents=True, exist_ok=True)
    js.write_text(json.dumps(info, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    idx_path = ROOT / "data" / "excel" / "index.json"
    idx = json.loads(idx_path.read_text(encoding="utf-8")) if idx_path.exists() else {"weeks": []}
    idx["weeks"] = [w for w in idx["weeks"] if w["week"] != week]
    idx["weeks"].append({"week": week, "title": t["title"], "type": t["type"], "game": game[0]})
    idx["weeks"].sort(key=lambda w: w["week"], reverse=True)
    idx_path.write_text(json.dumps(idx, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"{week}: {t['type']} · {game[0]} · {len(t['rows'])}행")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--week", help="과제 주 월요일 (YYYY-MM-DD). 기본: 이번 주 월요일(한국 시간)")
    ap.add_argument("--force", action="store_true")
    a = ap.parse_args()
    make(a.week or kst_monday().isoformat(), a.force)
