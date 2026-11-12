/**
 * 빌드 후처리 — 정적으로 만든 HTML에 인라인 스크립트 해시 CSP(meta)를 박는다. `npm run build`가 next build 뒤에 부른다.
 *
 * 왜 필요한가: 동적 페이지는 프록시가 요청마다 nonce를 주고 Next가 자기 스크립트에 붙인다. 정적 페이지는
 * 빌드 때 HTML이 만들어져 nonce를 넣을 수 없고, Next의 실험 기능 SRI도 외부 청크에만 integrity를 달 뿐
 * 인라인 RSC 페이로드(self.__next_f.push)는 그대로 둔다. 그래서 만들어진 HTML의 인라인 스크립트를 전부
 * 해시해 그 페이지 전용 정책을 HTML 머리에 넣는다. 프록시가 보내는 헤더 정책은 바깥 한계만 맡고
 * (lib/security/csp.ts의 STATIC_PAGE_CSP), 브라우저는 두 정책을 모두 통과한 스크립트만 실행한다.
 *
 * 함께 지키는 것 — 어긋나면 빌드를 실패시킨다:
 *  - 로케일 아래 정적 페이지는 전부 프록시의 정적 목록(cspPolicy.mjs)에 있어야 한다. 목록에 없으면 프록시가
 *    nonce 정책을 보내 이 HTML의 스크립트가 전부 막힌다(화면은 나오는데 하이드레이션이 안 된다).
 *  - 목록의 경로는 실제로 정적 페이지로 만들어져야 한다. 아니면 그 경로가 요청마다 nonce 없이 렌더된다.
 *  - 정적 페이지는 ISR(revalidate)이면 안 된다. 런타임에 다시 만든 HTML에는 이 해시가 없다.
 *
 * 사용법: node scripts/csp-static-pages.mjs   (apps/web에서, next build 직후)
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import nextEnv from "@next/env";
import { STATIC_PAGE_PATHS, isStaticPagePath, staticPageMetaPolicy } from "../src/lib/security/cspPolicy.mjs";

const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SERVER_APP = path.join(APP_DIR, ".next", "server", "app");
/** i18n/routing.ts와 같아야 한다 — 다르면 아래 로케일 검사가 잡는다 */
const LOCALES = ["ko", "en"];

// next build와 같은 환경변수(.env*)를 읽는다 — 허용 출처(GTM·결제)가 빌드 결과와 같아야 한다
nextEnv.loadEnvConfig(APP_DIR, false, { info: () => {}, error: console.error });

/** 실행되는 인라인 스크립트인지 — src가 없고, type이 없거나 JS 계열 */
const JS_TYPES = new Set(["", "text/javascript", "application/javascript", "module"]);
const SCRIPT_RE = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
const META_RE = /<meta http-equiv="Content-Security-Policy" content="[^"]*"\/>/;

const sha256 = (s) => `'sha256-${createHash("sha256").update(s, "utf8").digest("base64")}'`;

function inlineScriptHashes(html, file, problems) {
  const hashes = new Set();
  for (const [, attrs, body] of html.matchAll(SCRIPT_RE)) {
    if (/\ssrc\s*=/i.test(attrs)) continue;
    const type = /\stype\s*=\s*"([^"]*)"/i.exec(attrs)?.[1]?.trim().toLowerCase() ?? "";
    if (!JS_TYPES.has(type)) continue; // application/ld+json 등 데이터 블록은 실행되지 않는다
    if (/\snonce\s*=/i.test(attrs)) problems.push(`${file}: 정적 HTML에 nonce가 들어 있다 — 렌더가 요청 헤더를 읽었다`);
    hashes.add(sha256(body));
  }
  return [...hashes];
}

function injectMeta(html, policy, file, problems) {
  const meta = `<meta http-equiv="Content-Security-Policy" content="${policy}"/>`;
  // 다시 돌려도 같은 결과가 나오게 — 이전에 넣은 것을 빼고 새로 넣는다
  const clean = html.replace(META_RE, "");
  // charset 선언은 문서 첫 1024바이트 안에 있어야 하므로 그 뒤, 다른 모든 head 요소(스크립트 포함)보다 앞에 둔다
  const charset = /<meta charSet="utf-8"\/>/i.exec(clean);
  const head = /<head[^>]*>/i.exec(clean);
  const anchor = charset ?? head;
  if (!anchor) {
    problems.push(`${file}: <head>를 찾지 못해 CSP를 넣을 수 없다`);
    return html;
  }
  const at = anchor.index + anchor[0].length;
  return clean.slice(0, at) + meta + clean.slice(at);
}

function main() {
  const manifestPath = path.join(APP_DIR, ".next", "prerender-manifest.json");
  if (!existsSync(manifestPath)) throw new Error(".next/prerender-manifest.json이 없다 — next build 뒤에 실행할 것");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const problems = [];
  const done = [];

  for (const [route, info] of Object.entries(manifest.routes)) {
    const file = path.join(SERVER_APP, `${route === "/" ? "index" : route}.html`);
    if (!existsSync(file)) continue; // HTML이 아닌 정적 결과(robots.txt·sitemap.xml·API 응답 등)

    const first = route.split("/")[1];
    const localized = /^[a-z]{2}$/.test(first);
    if (localized && !LOCALES.includes(first)) problems.push(`${route}: 모르는 로케일 — LOCALES를 i18n/routing.ts와 맞출 것`);
    if (localized) {
      if (!isStaticPagePath(route, { locales: LOCALES })) {
        problems.push(
          `${route}: 정적 페이지로 만들어졌지만 프록시의 정적 목록(cspPolicy.mjs STATIC_PAGE_PATHS)에 없다 — ` +
            `목록에 더하거나, 요청마다 렌더해야 하는 페이지면 await connection()으로 동적으로 만든다`,
        );
      }
      if (info.initialRevalidateSeconds !== false && info.initialRevalidateSeconds !== undefined) {
        problems.push(`${route}: revalidate ${info.initialRevalidateSeconds}초(ISR) — 런타임에 다시 만든 HTML에는 CSP 해시가 없다`);
      }
    }

    const rel = path.relative(APP_DIR, file);
    const html = readFileSync(file, "utf8");
    const hashes = inlineScriptHashes(html, rel, problems);
    writeFileSync(file, injectMeta(html, staticPageMetaPolicy(hashes, process.env), rel, problems));
    done.push(`${route} (${hashes.length})`);
  }

  // 목록에 있는데 정적으로 만들어지지 않은 경로 — 프록시가 nonce 없이 보내게 된다
  for (const locale of LOCALES) {
    for (const p of STATIC_PAGE_PATHS) {
      const route = `/${locale}${p}`;
      if (!manifest.routes[route]) {
        problems.push(`${route}: 정적 목록에 있지만 정적 페이지로 만들어지지 않았다 — 요청 정보·DB를 읽는 코드가 들어갔는지 확인할 것`);
      }
    }
  }

  if (problems.length > 0) {
    console.error(`\n[csp-static-pages] 실패 ${problems.length}건:`);
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }
  console.log(`[csp-static-pages] 정적 HTML ${done.length}개에 해시 CSP를 넣었다 (괄호 안은 인라인 스크립트 수)`);
  console.log(`  ${done.join(", ")}`);
}

main();
