import "server-only";
import crypto from "node:crypto";

/**
 * PDF 생성용 단기 서명 토큰.
 * 헤드리스 브라우저가 쿠키 없이 보고서 페이지를 열 수 있도록,
 * 특정 스캔 1건에 대해서만 10분간 유효한 접근 토큰을 발급한다.
 */
const TTL_MS = 10 * 60_000;

function secret(): string {
  const s = process.env.INTERNAL_API_SECRET;
  if (!s || s === "change-me") throw new Error("INTERNAL_API_SECRET이 설정되지 않았습니다.");
  return s;
}

function hmac(payload: string): string {
  return crypto.createHmac("sha256", secret()).update(payload).digest("base64url");
}

export function signReportToken(scanId: string): string {
  const exp = Date.now() + TTL_MS;
  return `${exp}.${hmac(`${scanId}.${exp}`)}`;
}

export function verifyReportToken(scanId: string, token: string): boolean {
  const [expStr, sig] = token.split(".");
  if (!expStr || !sig) return false;
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || exp < Date.now()) return false;
  const expected = hmac(`${scanId}.${exp}`);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
