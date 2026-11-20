# 심플 다이어트

개인용 체중 기록 웹앱 (아이폰 홈 화면용). https://uhyun6907-boop.github.io/

## 데이터가 있는 곳

- 기기 안: IndexedDB(`simple-diet`)와 localStorage(`my-simple-diet-v1`)에 같은 상태를 저장합니다. 저장에 실패하면 화면 위에 "저장소에 쓰지 못했어요"가 뜹니다.
- GitHub 동기화(설정에서 토큰을 넣었을 때만): 비공개 저장소 `uhyun6907-boop/sd-data`의 `records.json`과 양방향으로 맞춥니다. 키(`YYYY-MM-DD 오전|오후`)마다 나중에 고친 값이 이깁니다.
- 이 저장소에는 기록 데이터가 없습니다.

## 빌드

```sh
npm ci
npm run typecheck
npm run build
```

`npm run build`(= `bash build.sh`)는 `src/`를 묶어 저장소 루트의 `index.html`, `sw.js`, `manifest.webmanifest`를 다시 씁니다. `sw.js`의 캐시 이름(`sd-<해시>-9`)은 번들 해시로 바뀌므로, 빌드 결과물도 함께 커밋해야 배포된 앱이 갱신됩니다.

## 규칙

기본 목표 체중, 기본 목표 경로 구간, 오전 시간대(04:00–12:00), 체중 범위, 저장 키, 동기화 대상 저장소는 `src/rules.json` 한 곳에 있습니다. 앱(`src/rules.ts`)과 `tools/sdrec.py`가 같은 파일을 읽습니다. 목표 경로 시작일은 기본값이 없고, 첫 기록이 생기거나 사용자가 정할 때 정해집니다.

## 도구

`tools/sd-add.py`: 터미널에서 `sd-data`의 기록을 추가·수정·삭제합니다(`gh` 로그인 필요, `--dry-run` 지원). `python3 tools/sd-add.py --help` 참고.
