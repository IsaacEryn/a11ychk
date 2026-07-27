/**
 * 층화 표집(stratified sampling) — WCAG-EM 2.0 구조 표본을 한도 비례 배분으로 자동화한다.
 *
 * 후보 페이지를 (1) 공통·필수 유형(홈·로그인·문의·폼 등)과 (2) 반복 콘텐츠 클러스터
 * (게시판·포스트·상품)로 층화한 뒤, 회원별 표본 한도(max)를 다음 순서로 배분한다.
 *   Round-1(coverage): 홈 → 로그인·문의 → 클러스터별 대표 1개 → 나머지 공통 → 정적 콘텐츠
 *   Round-2(proportional): 남은 한도를 클러스터 크기 비례(largest-remainder/Hamilton)로 추가
 * 이렇게 하면 한도가 작아도(free=5) 반복 콘텐츠 대표가 최소 1개는 확보되고, 한도가 크면
 * 큰 클러스터일수록 더 많은 대표가 뽑힌다.
 *
 * 결정적(재현 가능) — 모든 정렬에 콘텐츠 해시 기반 tiebreak을 써 같은 입력이면 같은 표본.
 * IO·Node 의존이 없는 순수 모듈이라 나중에 독립 패키지로 떼어내기 쉽다(내부 의존은 순수 헬퍼뿐).
 */
import type { Candidate } from "./collectPages";
import { prioritizeUrls } from "./collectPages";
import { isRepeatingKey, normalizeForDedup, templateKey } from "./urlTemplate";
import type { PageCategory, RepeatingCluster, SampledPage } from "../types";

/** URL 경로·질의로 공통 페이지 유형을 분류. content = 유형 미상(반복 콘텐츠 후보 포함). */
export function categorizePage(url: string, isRoot: boolean): PageCategory {
  if (isRoot) return "home";
  const path = (() => {
    try {
      return (new URL(url).pathname + new URL(url).search).toLowerCase();
    } catch {
      return url.toLowerCase();
    }
  })();
  if (/(^|\/)(login|signin|sign-in|auth|account\/login|로그인)/.test(path)) return "login";
  if (/(contact|문의|inquiry|고객|support|1:1)/.test(path)) return "contact";
  if (/sitemap|사이트맵/.test(path)) return "sitemap";
  if (/(help|faq|도움말|가이드|guide|고객센터)/.test(path)) return "help";
  if (/(privacy|terms|policy|약관|개인정보|이용약관)/.test(path)) return "legal";
  if (/(search|검색)/.test(path)) return "search";
  if (/(join|signup|sign-up|register|가입|주문|order|checkout|결제|apply|신청)/.test(path)) return "form";
  return "content";
}

/** 결정적 tiebreak용 콘텐츠 해시 (FNV-1a). 사이트별로 시드해 URL 순서 편향을 없앤다. */
function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function depthOf(url: string): number {
  try {
    return new URL(url).pathname.split("/").filter(Boolean).length;
  } catch {
    return 99;
  }
}

/** 클러스터 내 대표 글 정렬: 최신(lastmod) → 우선순위(priority) → 결정적 해시. */
function representativeCmp(rootUrl: string): (a: Candidate, b: Candidate) => number {
  return (a, b) => {
    const la = a.lastmod ?? "";
    const lb = b.lastmod ?? "";
    if (la !== lb) return la < lb ? 1 : -1; // ISO 문자열 비교 = 시간순, 최신(큰 값) 먼저
    const pa = a.priority ?? -1;
    const pb = b.priority ?? -1;
    if (pa !== pb) return pb - pa;
    return hashString(rootUrl + "|" + a.url) - hashString(rootUrl + "|" + b.url);
  };
}

/** 공통 유형 대표 정렬: 얕은 경로 우선 → 결정적 해시. */
function shallowCmp(rootUrl: string): (a: Candidate, b: Candidate) => number {
  return (a, b) => {
    const da = depthOf(a.url);
    const db = depthOf(b.url);
    if (da !== db) return da - db;
    return hashString(rootUrl + "|" + a.url) - hashString(rootUrl + "|" + b.url);
  };
}

/**
 * largest-remainder(Hamilton) 배분 — `total`개를 sizes 비례로 나누되 avail(잔여 여유)로 상한.
 * 상한에 걸려 남은 몫은 여유 있는 대상에게 재분배한다(작은 규모·적은 자원에서 안전).
 * tiebreak: 소수부 desc → 규모 desc → key asc (결정적).
 */
function hamiltonAllocate(sizes: number[], avail: number[], total: number, keys: string[]): number[] {
  const n = sizes.length;
  const alloc = new Array<number>(n).fill(0);
  let remaining = total;
  while (remaining > 0) {
    const eligible: number[] = [];
    let totalSize = 0;
    for (let i = 0; i < n; i++) {
      if (alloc[i]! < avail[i]!) {
        eligible.push(i);
        totalSize += sizes[i]!;
      }
    }
    if (eligible.length === 0 || totalSize === 0) break;
    const quota = eligible.map((i) => (remaining * sizes[i]!) / totalSize);
    let assigned = 0;
    quota.forEach((q, idx) => {
      const i = eligible[idx]!;
      const give = Math.min(Math.floor(q), avail[i]! - alloc[i]!);
      alloc[i]! += give;
      assigned += give;
    });
    remaining -= assigned;
    if (remaining <= 0) break;
    // 나머지 몫을 소수부 큰 순으로 1개씩
    const fracs = eligible
      .map((i, idx) => ({ i, frac: quota[idx]! - Math.floor(quota[idx]!), size: sizes[i]!, key: keys[i]! }))
      .filter((e) => alloc[e.i]! < avail[e.i]!)
      .sort((a, b) => b.frac - a.frac || b.size - a.size || (a.key < b.key ? -1 : 1));
    let progressed = false;
    for (const e of fracs) {
      if (remaining <= 0) break;
      alloc[e.i]! += 1;
      remaining -= 1;
      progressed = true;
    }
    if (!progressed && assigned === 0) break; // 진전 없음 — 무한 루프 방지
  }
  return alloc;
}

export interface StratifiedSampleInput {
  rootUrl: string;
  candidates: Candidate[];
  /** 구조 표본 최대 페이지 수 (회원별 한도) */
  max: number;
}

export interface AllocationResult {
  /** 루트(home)를 첫 원소로 포함한 구조 표본 */
  structured: SampledPage[];
  /** 표본에 대표가 1개 이상 선정된 반복 콘텐츠 클러스터 요약 */
  clusters: RepeatingCluster[];
}

/**
 * 후보에서 층화 구조 표본을 선정한다. (무작위 표본은 호출부 buildSample이 별도로 추가)
 */
export function stratifiedSample(input: StratifiedSampleInput): AllocationResult {
  const { rootUrl, candidates, max } = input;
  const structured: SampledPage[] = [{ url: rootUrl, category: "home", sampleType: "structured" }];
  const chosen = new Set<string>([rootUrl]);
  if (max <= 1) return { structured, clusters: [] };

  // 1) 중복 제거(페이지네이션 접기) + 루트 제외
  const seenDedup = new Set<string>();
  const unique: Candidate[] = [];
  for (const c of candidates) {
    if (c.url === rootUrl) continue;
    const key = normalizeForDedup(c.url);
    if (seenDedup.has(key)) continue;
    seenDedup.add(key);
    unique.push(c);
  }

  // 2) 층화 분류
  const commonByCat = new Map<PageCategory, Candidate[]>();
  const clusterMap = new Map<string, Candidate[]>();
  const staticContent: Candidate[] = [];
  for (const c of unique) {
    const cat = categorizePage(c.url, false);
    if (cat !== "content") {
      const bucket = commonByCat.get(cat);
      if (bucket) bucket.push(c);
      else commonByCat.set(cat, [c]);
      continue;
    }
    const key = templateKey(c.url);
    if (isRepeatingKey(key)) {
      const bucket = clusterMap.get(key);
      if (bucket) bucket.push(c);
      else clusterMap.set(key, [c]);
    } else {
      staticContent.push(c);
    }
  }

  // 3) 크기 2 이상만 반복 클러스터로 인정 (1개짜리는 정적 콘텐츠로 흡수)
  const clusters: { key: string; members: Candidate[] }[] = [];
  for (const [key, members] of clusterMap) {
    if (members.length >= 2) clusters.push({ key, members });
    else staticContent.push(...members);
  }

  // 정렬
  const repCmp = representativeCmp(rootUrl);
  for (const cl of clusters) cl.members.sort(repCmp);
  const shallow = shallowCmp(rootUrl);
  for (const [, members] of commonByCat) members.sort(shallow);
  // 클러스터 순서: 크기 desc → 최신 lastmod desc → key asc
  clusters.sort((A, B) => {
    if (A.members.length !== B.members.length) return B.members.length - A.members.length;
    const na = A.members[0]!.lastmod ?? "";
    const nb = B.members[0]!.lastmod ?? "";
    if (na !== nb) return na < nb ? 1 : -1;
    return A.key < B.key ? -1 : 1;
  });

  const clusterTaken = new Map<string, number>();
  const pushPage = (c: Candidate, repeatingKey?: string): boolean => {
    if (chosen.has(c.url) || structured.length >= max) return false;
    structured.push({
      url: c.url,
      category: categorizePage(c.url, false),
      sampleType: "structured",
      ...(repeatingKey ? { isRepeating: true, templateKey: repeatingKey } : {}),
    });
    chosen.add(c.url);
    return true;
  };

  // ── Round-1: 커버리지 (스트라텀별 1개) ──
  // a. 로그인·문의
  for (const cat of ["login", "contact"] as const) {
    const pool = commonByCat.get(cat);
    if (pool?.[0]) pushPage(pool[0]);
  }
  // b. 반복 클러스터 대표 1개씩
  for (const cl of clusters) {
    if (structured.length >= max) break;
    if (pushPage(cl.members[0]!, cl.key)) clusterTaken.set(cl.key, 1);
  }
  // c. 나머지 공통 유형
  for (const cat of ["form", "help", "legal", "search", "sitemap"] as const) {
    const pool = commonByCat.get(cat);
    if (pool?.[0]) pushPage(pool[0]);
  }
  // d. 정적 콘텐츠 (다양성 순)
  const staticByUrl = new Map(staticContent.map((c) => [c.url, c]));
  for (const u of prioritizeUrls([...staticByUrl.keys()], rootUrl)) {
    if (structured.length >= max) break;
    const c = staticByUrl.get(u);
    if (c) pushPage(c);
  }

  // ── Round-2: 클러스터 크기 비례 추가 배분 ──
  const leftover = max - structured.length;
  if (leftover > 0 && clusters.length > 0) {
    const cap = Math.ceil(max / 2); // 한 클러스터가 표본을 독식하지 못하게
    const sizes = clusters.map((cl) => cl.members.length);
    const avail = clusters.map((cl) => Math.min(cl.members.length, cap) - (clusterTaken.get(cl.key) ?? 0));
    const alloc = hamiltonAllocate(
      sizes,
      avail.map((a) => Math.max(0, a)),
      leftover,
      clusters.map((cl) => cl.key),
    );
    for (let i = 0; i < clusters.length; i++) {
      const cl = clusters[i]!;
      let taken = clusterTaken.get(cl.key) ?? 0;
      for (let k = 0; k < alloc[i]! && structured.length < max; k++) {
        const member = cl.members[taken];
        if (!member) break;
        if (pushPage(member, cl.key)) taken++;
      }
      clusterTaken.set(cl.key, taken);
    }
  }

  // ── 안전망: 그래도 자리가 남으면 남은 후보로 채움 ──
  if (structured.length < max) {
    const rest = unique.filter((c) => !chosen.has(c.url));
    const restByUrl = new Map(rest.map((c) => [c.url, c]));
    for (const u of prioritizeUrls([...restByUrl.keys()], rootUrl)) {
      if (structured.length >= max) break;
      const c = restByUrl.get(u);
      if (!c) continue;
      const key = templateKey(c.url);
      const isCluster = clusterTaken.has(key);
      if (pushPage(c, isCluster ? key : undefined) && isCluster) {
        clusterTaken.set(key, (clusterTaken.get(key) ?? 0) + 1);
      }
    }
  }

  const clusterSummaries: RepeatingCluster[] = clusters
    .filter((cl) => (clusterTaken.get(cl.key) ?? 0) >= 1)
    .map((cl) => ({ templateKey: cl.key, total: cl.members.length, sampled: clusterTaken.get(cl.key)! }));

  return { structured, clusters: clusterSummaries };
}
