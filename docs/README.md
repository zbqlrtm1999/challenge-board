# 취업 준비 챌린지보드

게임운영 지망생이 매일 CS 답변, 운영 실무 활동, 생활 습관을 기록하고 성장을 확인하는 보드예요.

- **보드:** https://zbqlrtm1999.github.io/challenge-board/
- **공유용 요약:** https://zbqlrtm1999.github.io/challenge-board/#summary

## 무엇을 하나요

- **매일:** 아침 비타민 → 공고 확인 → 직무능력준비 → 운동
- **직무능력준비:** 가상 게임 CS 문의 3개에 답변 + 오늘의 활동 1개 (패치노트 분석 / 커뮤니티 보고서 / 공지 작성 / 엑셀 과제)
- **매주 같은 요일엔 같은 문의**가 다시 와서, 지난 답변과 나란히 비교할 수 있어요.
- **매주 일요일 23:50** AI 코치가 채점과 피드백을 남겨요. 답변은 모두 직접 쓰고, AI는 피드백만 해요.
- **매주 월요일** 숨은 원인이 있는 가상 운영 데이터 엑셀 과제가 자동으로 만들어져요.

## 화면

| 탭 | 내용 |
| --- | --- |
| 오늘 | 일일 항목, 오늘의 CS 문의, 이번 주 게임, 메인 미션, 오늘의 활동, 저장 |
| 미션 | 미션 진행, 게임별 결과물, 결과물 비교 |
| 기록 | 문의 카드 → 주차별 답변 → 두 답변 비교 / 날짜별 기록 |
| 통계 | 연속 기록, 달성률, CS 점수 변화, 잔디, 작은 카드 3개 |
| 설정 | 시작일, 일일 항목, 게임 목록, 보드 열쇠, 내 폴더 |
| 사용법 | 화면 배치를 누르면 설명이 나와요 |

## 내 보드로 쓰기 (템플릿)

1. 이 저장소 오른쪽 위 **Use this template** → **Create a new repository** (공개 저장소)
2. 새 저장소 → Settings → Pages → Source: **Deploy from a branch**, Branch: `main` / `/ (root)` → Save
3. 새 저장소 → Settings → Actions → General → Workflow permissions: **Read and write permissions** → Save (엑셀 과제 자동 생성용)
4. `data/records.json`과 `data/feedback.json`이 `{}`인지 확인하고, 아니면 `{}`로 바꿔요 (다른 사람 기록을 지우기 위해)
5. 보드 열쇠 만들기: [HOME_SETUP.md](HOME_SETUP.md) 1번 (저장소 이름만 자기 것으로)
6. 보드 → 설정 탭에서 제목, 시작일, 일일 항목, 게임 목록을 바꾸고 저장
7. (선택) 일요일 AI 채점: [HOME_SETUP.md](HOME_SETUP.md) 3번

게임운영이 아닌 직무라면 `packs/`에 새 직무 팩을 만들어요. 형식은 [AGENTS.md](AGENTS.md)의 "다른 직무 팩 만들기"를 보세요.

## 문서

- [AGENTS.md](AGENTS.md) — 규칙, 데이터 형식, 채점 절차 (Claude·Codex 공통)
- [DECISIONS.md](DECISIONS.md) — 왜 이렇게 만들었는지
- [HOME_SETUP.md](HOME_SETUP.md) — 집에서 할 일

CS 문의와 엑셀 데이터 속 게임·유저는 모두 가상이에요. 공지 작성 결과물의 [연습]은 실제 공지가 아니라는 표시예요.
