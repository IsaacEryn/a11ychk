import "server-only";
import { cache } from "react";
import type { User } from "@supabase/supabase-js";
import { createClient } from "./server";

/**
 * 요청 렌더 스코프로 메모이즈된 인증 사용자 조회.
 * auth.getUser()는 매번 Supabase Auth에 JWT 검증 왕복을 하므로, 헤더·페이지가
 * 각자 호출하면 한 번의 네비게이션에 왕복이 2~3회 쌓인다. React cache()로 감싸
 * 동일 렌더 패스 안에서는 단 한 번만 호출되게 한다(미들웨어 갱신은 별개 컨텍스트).
 */
export const getCachedUser = cache(async (): Promise<User | null> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
});
