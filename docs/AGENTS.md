# 챌린지보드 작업 규칙 (Claude · Codex 공통)

게임운영 지망생의 취업 준비 챌린지보드예요. 정적 웹페이지(GitHub Pages)이고, 기록은 이 저장소 안의 파일에 쌓여요. 이 문서는 이 저장소에서 일하는 AI가 지킬 규칙과 작업 방법을 담고 있어요. 왜 이렇게 만들었는지는 [DECISIONS.md](DECISIONS.md), 집에서 처음 설정할 일은 [HOME_SETUP.md](HOME_SETUP.md)를 보세요.

## 꼭 지킬 규칙

1. **개인정보를 쓰지 않는다.** 이름·연락처·주소·학번 같은 것은 문의글, 예시, 피드백, 문서, 커밋 메시지 어디에도 넣지 않는다. 가상 유저는 `U01234`처럼 번호로만 쓴다. 저장소는 공개다.
2. **보드 열쇠(GitHub 토큰)를 파일에 쓰지 않는다.** 열쇠는 사용자의 브라우저 sessionStorage에만 있다.
3. **CS 문의는 가상 게임으로만 만든다.** 실제 회사·게임 이름을 CS 문의에 넣지 않는다. 실제 게임은 "오늘의 활동"(패치노트 분석 등)에서만 쓴다.
4. **공지 작성 결과물에는 `[연습]`을 붙인다.** 실제 회사 공지로 오해받지 않게 하기 위해서다(보드가 제목 앞에 자동으로 붙인다).
5. **사용자가 쓴 글(`data/records.json`의 답변·활동)은 고치지 않는다.** AI는 `data/feedback.json`에만 쓴다.
6. **사용자가 요청한 범위만 한다.** 파일 구조를 바꾸거나 새 기능을 넣기 전에 사용자에게 확인한다.
7. 화면 문구와 피드백은 한국어 해요체로, 짧고 구체적으로 쓴다.

## 파일 구조

```
index.html, style.css, app.js     보드 화면 (빌드 없음, 바닐라 JS)
data/settings.json                제목, 시작일, 일일 항목, 게임 로테이션 (보드 설정 탭에서 저장)
data/missions.json                메인 미션 목록
data/records.json                 날짜별 기록 전체 (보드가 저장)
data/feedback.json                AI 코치 채점·피드백 (일요일 채점이 저장)
data/excel/index.json, <주>.json  주간 엑셀 과제 정보
records/<날짜>.md                 사람이 읽는 날짜별 기록 (보드가 저장할 때 함께 생성)
excel/<주>_엑셀과제.xlsx          주간 엑셀 과제 파일
packs/<팩>/pack.json              직무 팩: 채점 기준, 운영 정책, 가상 게임 7개, 문의 세트
packs/<팩>/activities.json        오늘의 활동 메뉴와 작성 틀
packs/<팩>/real-games.json        로테이션에 쓰는 실제 게임 목록
scripts/make_excel.py             엑셀 과제 생성기 (매주 월요일 0시 GitHub Actions)
.github/workflows/weekly-excel.yml 위 생성기를 돌리는 자동 작업
docs/                             안내 문서 (이 폴더)
```

## 동작 규칙 요약

- **날짜는 모두 한국 시간.** 챌린지 시작일(`settings.startDate`) 전은 연습 기간이라 통계에서 빠진다.
- **일일 항목:** 설정의 `dailyItems`. `type: "job"`인 직무능력준비는 자동 판정: CS 3개 + 활동 1개면 완료. 바쁜 날 모드(`busy`)면 CS 1개로 "가볍게 완료"(한 주 `busyLimitPerWeek`번까지).
- **CS 문의:** 요일(월=1…일=7)마다 가상 게임 1개, 문의 3개. 같은 요일에는 같은 문의가 매주 반복된다. 세트는 시작일이 속한 달부터 한 달마다 다음 세트로 바뀐다(세트 수만큼 돌면 처음으로).
- **실제 게임 로테이션:** `gameRotation` 순서대로 시작일 주 월요일부터 매주 바뀐다.
- **미션 진행:** 저장 값이 아니라 기록에서 계산한다. `menu`가 있는 미션은 그 메뉴 활동을 한 날 수, 없는 미션은 기록의 `missionManual[미션id]`가 있는 날 수.
- **수정 제한:** 새 기록은 오늘·어제만. 이미 있는 기록은 `feedback.json`에 그 날짜가 생기기 전까지 고칠 수 있다(채점되면 잠김). "다음엔 이렇게"(`reflect`)는 채점 뒤에도 쓸 수 있다.
- **휴대폰은 보기 전용**(화면 폭 640px 이하에서 작성 칸 숨김).

## 데이터 형식

### data/records.json
```json
{
  "2026-11-16": {
    "date": "2026-11-16", "savedAt": "ISO 시각", "late": false, "busy": false,
    "setId": "set1", "csGame": "starlight",
    "daily": { "vitamin": true, "jobs": true, "walk": false },
    "cs": { "answers": { "set1-1-1": "답변 글", "set1-1-2": "…" } },
    "activity": { "menu": "patch", "game": "lol", "fields": { "url": "https://…" }, "body": "본문",
                  "excel": { "week": "2026-11-16", "answers": { "q1": "282" }, "correct": { "q1": true }, "reason": "…", "report": "…" } },
    "missionManual": { "m-abc": "메모" },
    "memo": "한 줄 메모",
    "reflect": { "set1-1-1": "다음엔 이렇게…" }
  }
}
```

### data/feedback.json (AI만 씀)
```json
{
  "2026-11-16": {
    "gradedAt": "ISO 시각",
    "cs": {
      "set1-1-1": { "score": 4, "checks": { "greet": true, "empathy": true, "cause": true, "solution": false, "closing": true },
                    "violation": false, "comment": "고칠 점 한 줄", "change": "지난 답변과 달라진 점 한 줄 (이전 답변이 없으면 생략)" }
    },
    "activity": { "good": "잘한 점 한 줄", "fix": "고칠 점 한 줄", "change": "같은 메뉴 직전 결과물과 달라진 점 (없으면 생략)" },
    "excel": { "good": "…", "fix": "…" }
  }
}
```
`score` = 체크된 항목 수 − (위반이면 `pack.violation.penalty`), 최소 0.

## 일요일 AI 코치 채점 (매주 일요일 23:50 한국 시간)

예약 작업이나 "이번 주 채점해줘" 요청을 받으면 이 순서로 한다.

1. 최신 상태를 받는다 (`git pull`).
2. `data/records.json`에서 **날짜가 오늘(한국 시간) 이하이고 `data/feedback.json`에 아직 없는 날짜**를 모두 고른다. 시작일 전(연습 기간)도 채점한다.
3. 날짜마다:
   - **CS 답변:** `cs.answers`의 문의 id로 `packs/<팩>/pack.json`에서 문의(`text`, `facts`), 그 세트의 그 게임 `events`, `commonPolicy`와 게임 `policy`를 찾는다. `rubric` 5항목을 답변에 "들어 있는지"만 보고 true/false로 판정한다(잘 썼는지가 아니라 있는지). 정책에 없는 약속이나 개인정보 요청이 있으면 `violation: true`. `comment`는 가장 중요한 고칠 점 한 줄. 같은 문의에 대한 직전 답변이 있으면 `change`에 달라진 점 한 줄.
   - **활동 (`activity.menu`가 patch/community/notice):** 점수 없이 `good`, `fix` 한 줄씩. 같은 메뉴의 직전 결과물이 있으면 `change`.
   - **엑셀 (`menu`가 excel):** `data/excel/<주>.json`의 `reveal`(base64 JSON: 정답, 숨은 원인, 근거)과 사용자의 `reason`·`report`를 비교해 `excel.good`, `excel.fix`. 원인을 맞혔는지보다 **데이터에서 근거를 댔는지**를 본다.
4. `data/feedback.json`에 날짜별로 추가한다(이미 있는 날짜는 건드리지 않는다). `records.json`은 고치지 않는다.
5. 커밋 메시지 `AI 코치 채점: <첫 날짜>~<마지막 날짜>`로 커밋하고 push. 채점할 날짜가 없으면 아무것도 하지 않는다.

피드백 말투: 해요체, 한 줄에 하나만, 칭찬도 구체적으로. 예) "처리 일정이 빠졌어요. '오늘 18시까지'처럼 시각을 넣어 보세요."

## 자주 하는 작업

- **새 CS 문의 세트 만들기:** `pack.json`의 `sets`에 같은 형식으로 추가한다(요일 7개 × 3문의, 7개 게임 모두 `events`). 날짜는 "어제", "지난주 토요일"처럼 상대적으로 쓴다(매주 반복되므로). 문의 id는 `<세트id>-<요일>-<번호>`. 기존 세트는 지우지 않는다(지난 답변이 그 id를 가리킨다).
- **게임 목록 바꾸기:** 사용자는 보드 설정 탭에서 바꾼다. 기본 목록은 `real-games.json`.
- **엑셀 과제 종류 추가:** `scripts/make_excel.py`의 `TASKS`에 함수 추가. 같은 주는 같은 결과가 나오도록 `rng`만 쓴다. 정답은 데이터에서 직접 계산한다. 정답 정규화(`norm`)를 바꾸면 `app.js`의 `normAnswer`도 똑같이 바꾼다.
- **엑셀 과제 다시 만들기:** GitHub → Actions → "주간 엑셀 과제 만들기" → Run workflow (주 입력 가능). 로컬: `pip install openpyxl` 후 `python scripts/make_excel.py --week 2026-11-23`.
- **다른 직무 팩 만들기:** `packs/<새 팩>/`에 `pack.json`, `activities.json`, `real-games.json`을 같은 형식으로 만들고 `settings.json`의 `pack`을 바꾼다. 채점 기준(`rubric`)은 그 직무에 맞게 5개 안팎으로.

## 화면 수정 시

- 디자인은 모몽가 컬러 테마(하얀색 바탕, 연한 하늘색, 분홍 포인트, 남색 글자), 그라데이션 없음, 제목 글꼴 고운돋움 + 본문 Noto Sans KR. 색은 `style.css`의 `:root` 토큰만 쓴다(다크 모드 포함).
- 라이브러리 없이 바닐라 JS. 수정 후 `node --check app.js`로 문법을 확인한다.
- 사용법 탭(`GUIDE` in app.js)의 설명도 함께 고친다.
