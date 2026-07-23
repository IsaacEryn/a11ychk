/**
 * 서버 액션 배럴 — 기존 892줄 단일 파일을 역할별 모듈로 분할하고 임포트 경로는 유지한다.
 * (도메인/보고서/프로필·문의/관리자 — 각 파일이 "use server", 여기서는 재수출만)
 */
export { signOut, updateNickname, updatePreferredStandard, createInquiry } from "./actions/profile";
export type { NicknameState } from "./actions/profile";

export {
  addDomain,
  deleteDomain,
  toggleAutoScan,
  toggleNotify,
  setScanFrequency,
  setDisabledRules,
  setPublicReport,
  verifyDomain,
  setupCloudflareDns,
} from "./actions/domains";
export type { VerifyDomainState, CloudflareState } from "./actions/domains";

export { submitReferralAppeal } from "./actions/referral";
export { saveReview, saveReportMeta, savePublicView, toggleShareLink } from "./actions/reports";
export type { ShareState } from "./actions/reports";

export {
  refreshRepoStats,
  toggleBlockUser,
  resetQuota,
  setUserLimits,
  togglePlansActive,
  bulkSetPlan,
  bulkSetPages,
  replyInquiry,
  approveReferral,
  rejectReferral,
  clearEarnedPlan,
  sendUserEmail,
  adminRetryScan,
} from "./actions/admin";
export type { ResetQuotaState } from "./actions/admin";

export type { SaveState } from "./actions/shared";
