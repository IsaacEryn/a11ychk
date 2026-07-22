import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

// requireExtensionUser가 모듈 스코프에서 import하는 admin 클라이언트를 대체한다.
// 각 테스트가 mockAdmin을 원하는 응답으로 구성한 뒤 호출한다.
const { createAdminClient } = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient }));

import { requireExtensionUser, requireScanOwner } from "../src/lib/apiAuth";

const USER_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const SCAN_ID = "11111111-2222-3333-4444-555555555555";

function extReq(authorization?: string): Request {
  return new Request("https://a11ychk.com/api/extension/scan", {
    method: "POST",
    headers: authorization === undefined ? {} : { authorization },
  });
}

/** auth.getUser / profiles 조회 응답을 주입한 admin 클라이언트 스텁 */
function stubAdmin(opts: {
  user?: { id: string } | null;
  userError?: boolean;
  profile?: { blocked: boolean; scan_limit_override: unknown } | null;
}) {
  return {
    auth: {
      getUser: vi.fn().mockResolvedValue(
        opts.userError
          ? { data: { user: null }, error: { message: "invalid token" } }
          : { data: { user: opts.user ?? null }, error: null },
      ),
    },
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({ data: opts.profile ?? null, error: null }),
        }),
      }),
    }),
  };
}

describe("requireExtensionUser — 확장 API 인증 경계", () => {
  beforeEach(() => {
    createAdminClient.mockReset();
  });

  it("Authorization 헤더 없음 → 401 NextResponse", async () => {
    const res = await requireExtensionUser(extReq());
    expect(res).toBeInstanceOf(NextResponse);
    expect((res as NextResponse).status).toBe(401);
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it("Bearer 접두 없는 토큰 → 401", async () => {
    const res = await requireExtensionUser(extReq("some-raw-token"));
    expect(res).toBeInstanceOf(NextResponse);
    expect((res as NextResponse).status).toBe(401);
  });

  it("토큰 검증 실패(만료 등) → 401", async () => {
    createAdminClient.mockReturnValue(stubAdmin({ userError: true }));
    const res = await requireExtensionUser(extReq("Bearer expired-token"));
    expect(res).toBeInstanceOf(NextResponse);
    expect((res as NextResponse).status).toBe(401);
  });

  it("유저는 유효하나 프로필 없음 → 403", async () => {
    createAdminClient.mockReturnValue(stubAdmin({ user: { id: USER_ID }, profile: null }));
    const res = await requireExtensionUser(extReq("Bearer ok-token"));
    expect(res).toBeInstanceOf(NextResponse);
    expect((res as NextResponse).status).toBe(403);
  });

  it("차단된 계정(blocked) → 403", async () => {
    createAdminClient.mockReturnValue(
      stubAdmin({ user: { id: USER_ID }, profile: { blocked: true, scan_limit_override: null } }),
    );
    const res = await requireExtensionUser(extReq("Bearer ok-token"));
    expect(res).toBeInstanceOf(NextResponse);
    expect((res as NextResponse).status).toBe(403);
  });

  it("정상 인증 → { admin, user, profile } 반환 (NextResponse 아님)", async () => {
    const admin = stubAdmin({
      user: { id: USER_ID },
      profile: { blocked: false, scan_limit_override: null },
    });
    createAdminClient.mockReturnValue(admin);
    const res = await requireExtensionUser(extReq("Bearer ok-token"));
    expect(res).not.toBeInstanceOf(NextResponse);
    if (res instanceof NextResponse) throw new Error("unreachable");
    expect(res.user.id).toBe(USER_ID);
    expect(res.profile.blocked).toBe(false);
    expect(res.admin).toBe(admin);
  });
});

describe("requireScanOwner — 스캔 소유 재확인 경계", () => {
  /** scans 조회 결과와 select 인자 기록을 주입한 db 스텁 */
  function stubDb(row: unknown) {
    const calls: { select?: string; scanId?: string } = {};
    const db = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockImplementation((sel: string) => {
          calls.select = sel;
          return {
            eq: vi.fn().mockImplementation((_col: string, val: string) => {
              calls.scanId = val;
              return { maybeSingle: vi.fn().mockResolvedValue({ data: row, error: null }) };
            }),
          };
        }),
      }),
    } as unknown as SupabaseClient;
    return { db, calls };
  }

  it("소유자 일치 → 행 반환", async () => {
    const row = { id: SCAN_ID, user_id: USER_ID, status: "done" };
    const { db } = stubDb(row);
    const scan = await requireScanOwner(db, SCAN_ID, USER_ID);
    expect(scan).toEqual(row);
  });

  it("user_id 불일치(타인 행이 조회돼도) → null — 이 함수의 존재 이유", async () => {
    const { db } = stubDb({ id: SCAN_ID, user_id: "other-user" });
    expect(await requireScanOwner(db, SCAN_ID, USER_ID)).toBeNull();
  });

  it("스캔 미존재 → null", async () => {
    const { db } = stubDb(null);
    expect(await requireScanOwner(db, SCAN_ID, USER_ID)).toBeNull();
  });

  it("select 인자·scanId가 쿼리에 그대로 전달됨", async () => {
    const { db, calls } = stubDb({ id: SCAN_ID, user_id: USER_ID, summary: {} });
    await requireScanOwner(db, SCAN_ID, USER_ID, "id, user_id, summary");
    expect(calls.select).toBe("id, user_id, summary");
    expect(calls.scanId).toBe(SCAN_ID);
  });
});
