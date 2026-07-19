import "server-only";
import { timingSafeEqual } from "node:crypto";

/**
 * Vercel Cron의 Authorization: Bearer <CRON_SECRET> 검증 (상수시간 비교).
 * 길이가 다르면 즉시 false — timingSafeEqual은 동일 길이 버퍼만 허용한다.
 */
export function isAuthorizedCron(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const authz = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  const a = Buffer.from(authz);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
