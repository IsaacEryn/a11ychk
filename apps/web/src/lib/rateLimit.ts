import "server-only";

/**
 * HTTP 레이트리밋 카운터 — 외부 스토어가 설정돼 있으면 서버리스 인스턴스 간에 공유되고,
 * 없으면 인스턴스 메모리(best-effort)로 동작한다. Vercel 마켓플레이스의 Upstash Redis가
 * 주입하는 KV_REST_API_*와 Upstash 직접 연결의 UPSTASH_REDIS_REST_* 두 이름을 모두 받는다.
 * 스토어 장애·타임아웃 시에도 요청을 막지 않고 로컬 카운터로 폴백한다(가용성 우선).
 */
const STORE_URL = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL;
const STORE_TOKEN = process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN;

const local = new Map<string, number[]>();

/** 인메모리 슬라이딩 창 — 스토어 미설정·장애 시 폴백. 호출 인스턴스 안에서만 유효 */
export function allowRateLocal(key: string, limit: number, windowMs: number, now = Date.now()): boolean {
  const stamps = (local.get(key) ?? []).filter((t) => now - t < windowMs);
  if (stamps.length >= limit) {
    local.set(key, stamps);
    return false;
  }
  stamps.push(now);
  local.set(key, stamps);
  return true;
}

/**
 * key에 대해 windowMs 동안 limit회까지 허용. 공유 스토어에서는 고정 창(fixed window) 카운터 —
 * INCR + PEXPIRE 두 명령을 파이프라인 한 번으로 보낸다.
 * ponytail: 고정 창이라 창 경계에서 최대 2×limit 버스트 가능. 정밀 슬라이딩이 필요해지면
 * 정렬 집합(ZADD/ZREMRANGEBYSCORE)으로 교체.
 */
export async function allowRate(key: string, limit: number, windowMs: number): Promise<boolean> {
  if (STORE_URL && STORE_TOKEN) {
    try {
      const bucket = `rl:${key}:${Math.floor(Date.now() / windowMs)}`;
      const res = await fetch(`${STORE_URL}/pipeline`, {
        method: "POST",
        headers: { authorization: `Bearer ${STORE_TOKEN}`, "content-type": "application/json" },
        body: JSON.stringify([
          ["INCR", bucket],
          ["PEXPIRE", bucket, String(windowMs)],
        ]),
        signal: AbortSignal.timeout(2000),
      });
      if (res.ok) {
        const [first] = (await res.json()) as { result?: number; error?: string }[];
        if (typeof first?.result === "number") return first.result <= limit;
      }
    } catch {
      // 스토어 장애 → 로컬 폴백
    }
  }
  return allowRateLocal(key, limit, windowMs);
}
