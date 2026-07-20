import "server-only";

/**
 * Cloudflare DNS 자동 설정 헬퍼 — 사용자가 제공한 API 토큰으로 소유 확인용 TXT 레코드
 * (_a11ychk.<host>)를 해당 존에 생성한다.
 *
 * 보안: 토큰은 **저장하지 않는다**. 이 요청 동안만 메모리에서 쓰고 즉시 버린다. 고정 호스트
 * (api.cloudflare.com)로만 호출하므로 SSRF 표면이 아니다. 토큰은 절대 로깅하지 않는다.
 */
const CF_API = "https://api.cloudflare.com/client/v4";
const CF_TIMEOUT_MS = 10_000;

export type CloudflareSetupResult =
  | { status: "ok" }
  | { status: "auth_error" } // 토큰 무효/권한 부족
  | { status: "zone_not_found" } // 토큰으로 접근 가능한 존 중 이 호스트에 해당하는 것이 없음
  | { status: "api_error" }; // 그 외 Cloudflare API 오류

interface CfZone {
  id: string;
  name: string;
}
interface CfEnvelope<T> {
  success: boolean;
  result: T;
}

async function cfFetch(url: string, token: string, init: RequestInit = {}): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CF_TIMEOUT_MS);
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        ...(init.headers ?? {}),
      },
    });
  } finally {
    clearTimeout(timer);
  }
}

/** TXT 레코드 content 비교용 — Cloudflare가 값 앞뒤에 큰따옴표를 붙여 반환할 수 있어 벗겨서 비교 */
function unquote(s: string): string {
  return s.replace(/^"|"$/g, "");
}

/**
 * 토큰이 접근 가능한 존 중 hostname의 접미사와 일치하는 가장 긴 존을 찾아 TXT 레코드를 upsert.
 * 존 이름을 Cloudflare에서 직접 받으므로 다중 라벨 TLD(co.kr 등)도 정확히 매칭된다.
 */
export async function setupCloudflareTxt(
  token: string,
  hostname: string,
  recordName: string,
  content: string,
): Promise<CloudflareSetupResult> {
  // 1) 토큰이 볼 수 있는 존 목록
  let zonesRes: Response;
  try {
    zonesRes = await cfFetch(`${CF_API}/zones?per_page=50`, token);
  } catch {
    return { status: "api_error" };
  }
  if (zonesRes.status === 401 || zonesRes.status === 403) return { status: "auth_error" };
  const zonesJson = (await zonesRes.json().catch(() => null)) as CfEnvelope<CfZone[]> | null;
  if (!zonesJson?.success) return { status: "api_error" };

  const zone = (zonesJson.result ?? [])
    .filter((z) => hostname === z.name || hostname.endsWith(`.${z.name}`))
    .sort((a, b) => b.name.length - a.name.length)[0];
  if (!zone) return { status: "zone_not_found" };

  // 2) 동일 이름 TXT 레코드 조회 — 이미 우리 토큰이 있으면 생성 생략(멱등)
  let listRes: Response;
  try {
    listRes = await cfFetch(
      `${CF_API}/zones/${zone.id}/dns_records?type=TXT&name=${encodeURIComponent(recordName)}`,
      token,
    );
  } catch {
    return { status: "api_error" };
  }
  const listJson = (await listRes.json().catch(() => null)) as CfEnvelope<{ content: string }[]> | null;
  if (!listJson?.success) return { status: "api_error" };
  if ((listJson.result ?? []).some((r) => unquote(r.content ?? "") === content)) {
    return { status: "ok" };
  }

  // 3) TXT 레코드 생성
  let createRes: Response;
  try {
    createRes = await cfFetch(`${CF_API}/zones/${zone.id}/dns_records`, token, {
      method: "POST",
      body: JSON.stringify({ type: "TXT", name: recordName, content, ttl: 120, comment: "a11ychk ownership verification" }),
    });
  } catch {
    return { status: "api_error" };
  }
  const createJson = (await createRes.json().catch(() => null)) as CfEnvelope<unknown> | null;
  if (!createJson?.success) return { status: "api_error" };
  return { status: "ok" };
}
