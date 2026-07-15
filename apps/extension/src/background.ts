/**
 * 서비스 워커 — 확장 아이콘 클릭 시 사이드 패널을 연다.
 * 사이드 패널은 페이지를 클릭해도 닫히지 않아, 페이지 위 시각 도구 토글과
 * 전문가 판정 워크플로에 필수적이다 (팝업의 근본 한계 해소).
 */
chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => undefined);
});

// 설치 이벤트를 놓친 경우(개발 중 리로드 등)를 대비해 시작 시에도 설정
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => undefined);
