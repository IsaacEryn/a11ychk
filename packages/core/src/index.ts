/**
 * @a11ychk/core 서버 엔트리 — Node 전용 모듈(dns 등)을 포함한다.
 * 클라이언트(브라우저) 코드에서는 "@a11ychk/core/catalog"만 import할 것.
 */
export * from "./types";
export * from "./security/urlGuard";
export * from "./security/robots";
export * from "./crawler/collectPages";
export * from "./crawler/buildSample";
export * from "./access/checkAccess";
export * from "./scanner/runAxe";
export * from "./scanner/signature";
export * from "./catalog/rules";
export * from "./catalog/kwcag";
export * from "./catalog/wcag";
export * from "./manual/manualChecks";
export * from "./report/aggregate";
export * from "./report/siteChecks";
