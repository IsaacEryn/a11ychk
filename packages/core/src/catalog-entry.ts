/**
 * 클라이언트 안전 엔트리 (@a11ychk/core/catalog).
 * 순수 데이터·순수 함수만 — Node 내장 모듈을 import하지 않으므로
 * 브라우저 번들·크롬 확장에서 그대로 사용할 수 있다.
 */
export * from "./types";
export * from "./catalog/rules";
export * from "./catalog/kwcag";
export * from "./catalog/wcag";
export * from "./manual/manualChecks";
export * from "./report/aggregate";
export * from "./scanner/normalize";
export * from "./scanner/pageChecks";
export * from "./scanner/collectSignals";
