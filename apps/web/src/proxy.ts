import createIntlMiddleware from "next-intl/middleware";
import { type NextRequest } from "next/server";
import { routing } from "./i18n/routing";
import { updateSession } from "./lib/supabase/middleware";

const intlMiddleware = createIntlMiddleware(routing);

export async function proxy(request: NextRequest) {
  const response = intlMiddleware(request);
  return await updateSession(request, response);
}

export const config = {
  // API·정적 파일·auth 콜백 제외
  matcher: ["/((?!api|auth|_next|_vercel|.*\\..*).*)"],
};
