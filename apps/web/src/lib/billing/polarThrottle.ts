import "server-only";
import { allowRate } from "@/lib/rateLimit";

/**
 * 로그인 사용자가 Polar를 부르게 하는 요청(해외 결제 시작·고객 포털 열기·결제창 복귀)의 사용자당 한도 — 1분에 10번.
 * Polar 호출 한도는 조직 단위라 웹훅·크론·탈퇴와 함께 쓴다. 한 사용자가 반복 호출로 한도를 다 쓰지 못하게 막는다(돈과는 무관한
 * 가용성 문제). 공유 스토어가 있으면 인스턴스 사이에 공유되고, 없으면 인스턴스 메모리(rateLimit.ts). 키에는 사용자 id만 넣는다.
 */
const LIMIT = 10;
const WINDOW_MS = 60_000;

export function allowPolarCall(userId: string): Promise<boolean> {
  return allowRate(`polar-user:${userId}`, LIMIT, WINDOW_MS);
}
