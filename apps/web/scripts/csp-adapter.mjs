/**
 * Next 빌드 어댑터 — 정적으로 만든 HTML에 인라인 스크립트 해시 CSP(meta)를 넣은 뒤 배포 플랫폼의 어댑터에 넘긴다.
 * next.config.ts의 adapterPath가 이 파일을 가리킨다.
 *
 * 왜 해시인가: 동적 페이지는 프록시가 요청마다 nonce를 주고 Next가 자기 스크립트에 붙인다. 정적 페이지는 빌드 때
 * HTML이 만들어져 nonce를 넣을 수 없고, Next의 실험 기능 SRI도 외부 청크에만 integrity를 달 뿐 인라인 RSC
 * 페이로드(self.__next_f.push)는 그대로 둔다. 그래서 만들어진 HTML의 인라인 스크립트를 전부 해시해 그 페이지 전용
 * 정책을 HTML 머리에 넣는다. 프록시가 보내는 헤더 정책은 바깥 한계만 맡고(lib/security/csp.ts의 STATIC_PAGE_CSP),
 * 브라우저는 두 정책을 모두 통과한 스크립트만 실행한다.
 *
 * 왜 어댑터인가: Next 16은 배포 플랫폼(Vercel 등)이 NEXT_ADAPTER_PATH로 지정한 어댑터의 onBuildComplete를
 * `next build` 안에서 부르고, 플랫폼 어댑터가 그때 HTML을 배포 산출물로 옮긴다. next build가 끝난 뒤 .next의 HTML을
 * 고치면 로컬 `next start`에는 반영되지만 배포본에는 반영되지 않는다. 그래서 adapterPath를 이 파일로 정해 플랫폼
 * 어댑터보다 먼저 HTML을 고치고, 플랫폼 어댑터는 여기서 대신 불러 준다(adapterPath를 정하면 Next는
 * NEXT_ADAPTER_PATH를 보지 않는다). 빌드 명령과 무관하게 `next build`만으로 성립한다.
 *
 * 함께 지키는 것 — 어긋나면 빌드를 실패시킨다:
 *  - 로케일 아래 정적 페이지는 전부 프록시의 정적 목록(cspPolicy.mjs)에 있어야 한다. 목록에 없으면 프록시가
 *    nonce 정책을 보내 이 HTML의 스크립트가 전부 막힌다(화면은 나오는데 하이드레이션이 안 된다).
 *  - 목록의 경로는 실제로 정적 페이지로 만들어져야 한다. 아니면 그 경로가 요청마다 nonce 없이 렌더된다.
 *  - 정적 페이지는 ISR(revalidate)이면 안 된다. 런타임에 다시 만든 HTML에는 이 해시가 없다.
 *  - .next/server의 HTML(서버 함수가 런타임에 읽는다)과 플랫폼 어댑터가 만든 배포 산출물의 정적 HTML에도
 *    meta가 정확히 하나씩 있어야 한다.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { STATIC_PAGE_PATHS, isStaticPagePath, staticPageMetaPolicy } from "../src/lib/security/cspPolicy.mjs";

const SELF = fileURLToPath(import.meta.url);
const TAG = "[csp-adapter]";
/** i18n/routing.ts와 같아야 한다 — 다르면 아래 로케일 검사가 잡는다 */
const LOCALES = ["ko", "en"];

/** 실행되는 인라인 스크립트인지 — src가 없고, type이 없거나 JS 계열 */
const JS_TYPES = new Set(["", "text/javascript", "application/javascript", "module"]);
const SCRIPT_RE = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
const META_RE = /<meta http-equiv="Content-Security-Policy" content="[^"]*"\/>/g;
/** Next 앱 페이지 HTML의 표지 — 인라인 RSC 페이로드 */
const NEXT_HTML_MARK = "self.__next_f";

const sha256 = (s) => `'sha256-${createHash("sha256").update(s, "utf8").digest("base64")}'`;

/** HTML 안의 실행되는 인라인 스크립트 해시. nonce가 붙은 스크립트가 있으면(렌더가 요청 헤더를 읽었다) problems에 남긴다 */
export function inlineScriptHashes(html, label, problems) {
  const hashes = new Set();
  for (const [, attrs, body] of html.matchAll(SCRIPT_RE)) {
    if (/\ssrc\s*=/i.test(attrs)) continue;
    const type = /\stype\s*=\s*"([^"]*)"/i.exec(attrs)?.[1]?.trim().toLowerCase() ?? "";
    if (!JS_TYPES.has(type)) continue; // application/ld+json 등 데이터 블록은 실행되지 않는다
    if (/\snonce\s*=/i.test(attrs)) problems.push(`${label}: 정적 HTML에 nonce가 들어 있다 — 렌더가 요청 헤더를 읽었다`);
    hashes.add(sha256(body));
  }
  return [...hashes];
}

/** CSP meta를 charset 선언 바로 뒤에 넣는다. 다시 돌려도 같은 결과가 나오게 이전에 넣은 것은 빼고 넣는다 */
export function injectMeta(html, policy, label, problems) {
  const meta = `<meta http-equiv="Content-Security-Policy" content="${policy}"/>`;
  const clean = html.replace(META_RE, "");
  // charset 선언은 문서 첫 1024바이트 안에 있어야 하므로 그 뒤, 다른 모든 head 요소(스크립트 포함)보다 앞에 둔다
  const anchor = /<meta charSet="utf-8"\/>/i.exec(clean) ?? /<head[^>]*>/i.exec(clean);
  if (!anchor) {
    problems.push(`${label}: <head>를 찾지 못해 CSP를 넣을 수 없다`);
    return html;
  }
  const at = anchor.index + anchor[0].length;
  return clean.slice(0, at) + meta + clean.slice(at);
}

export const cspMetaCount = (html) => html.match(META_RE)?.length ?? 0;

/**
 * 고칠 HTML — 어댑터가 받은 정적 페이지(prerender)와 정적 파일, 그리고 prerender-manifest의 나머지 HTML.
 *
 * 정적 404(pages/404.html)가 있으면 Next는 /_not-found를 어댑터 출력에서 빼지만, 그 HTML은 서버 함수에 그대로
 * 실려 런타임 404에 쓰일 수 있어 같이 고친다.
 */
function staticHtmlOutputs(ctx) {
  const seen = new Map();
  for (const p of ctx.outputs.prerenders ?? []) {
    const file = p.fallback?.filePath;
    if (file?.endsWith(".html")) seen.set(file, { route: p.pathname, file, revalidate: p.fallback.initialRevalidate, shipped: true });
  }
  for (const s of ctx.outputs.staticFiles ?? []) {
    if (s.filePath?.endsWith(".html") && !seen.has(s.filePath)) seen.set(s.filePath, { route: s.pathname, file: s.filePath, revalidate: false, shipped: true });
  }
  const manifestPath = path.join(ctx.distDir, "prerender-manifest.json");
  if (existsSync(manifestPath)) {
    const { routes = {} } = JSON.parse(readFileSync(manifestPath, "utf8"));
    for (const [route, info] of Object.entries(routes)) {
      const file = path.join(ctx.distDir, "server", "app", `${route === "/" ? "index" : route}.html`);
      if (!seen.has(file) && existsSync(file)) seen.set(file, { route, file, revalidate: info.initialRevalidateSeconds, shipped: false });
    }
  }
  return [...seen.values()];
}

/**
 * 정적 HTML마다 해시 meta를 넣고 정적 목록과 맞는지 확인한다. 고친 페이지 목록을 돌려준다.
 *
 * @param {{ route: string; file: string; revalidate?: number | false; shipped?: boolean }[]} pages  shipped: 어댑터 출력에 있어 플랫폼이 배포 산출물로 옮기는 HTML
 * @param {Record<string, string | undefined>} env
 * @param {string[]} problems
 */
export function patchStaticPages(pages, env, problems) {
  const done = [];
  for (const { route, file, revalidate, shipped = true } of pages) {
    const first = route.split("/")[1] ?? "";
    if (/^[a-z]{2}$/.test(first)) {
      if (!LOCALES.includes(first)) problems.push(`${route}: 모르는 로케일 — LOCALES를 i18n/routing.ts와 맞출 것`);
      if (!isStaticPagePath(route, { locales: LOCALES })) {
        problems.push(
          `${route}: 정적 페이지로 만들어졌지만 프록시의 정적 목록(cspPolicy.mjs STATIC_PAGE_PATHS)에 없다 — ` +
            `목록에 더하거나, 요청마다 렌더해야 하는 페이지면 await connection()으로 동적으로 만든다`,
        );
      }
      if (revalidate !== false && revalidate !== undefined) {
        problems.push(`${route}: revalidate ${revalidate}초(ISR) — 런타임에 다시 만든 HTML에는 CSP 해시가 없다`);
      }
    }
    const html = readFileSync(file, "utf8");
    const hashes = inlineScriptHashes(html, route, problems);
    writeFileSync(file, injectMeta(html, staticPageMetaPolicy(hashes, env), route, problems));
    done.push({ route, scripts: hashes.length, shipped });
  }

  // 목록에 있는데 정적으로 만들어지지 않은 경로 — 프록시가 nonce 없이 보내게 된다
  const routes = new Set(pages.map((p) => p.route));
  for (const locale of LOCALES) {
    for (const p of STATIC_PAGE_PATHS) {
      if (!routes.has(`/${locale}${p}`)) {
        problems.push(`/${locale}${p}: 정적 목록에 있지만 정적 페이지로 만들어지지 않았다 — 요청 정보·DB를 읽는 코드가 들어갔는지 확인할 것`);
      }
    }
  }
  return done;
}

/** dir 아래 .html 파일 — node_modules와 디렉터리 심볼릭 링크는 건너뛴다 */
function* htmlFiles(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "node_modules") yield* htmlFiles(full);
    } else if (entry.name.endsWith(".html")) {
      try {
        if (statSync(full).isFile()) yield full;
      } catch {
        // 깨진 링크
      }
    }
  }
}

/** dir 아래 Next 앱 HTML마다 meta가 정확히 하나인지 — 확인한 파일 수를 돌려준다 */
function checkHtmlTree(dir, what, problems) {
  let found = 0;
  for (const file of htmlFiles(dir)) {
    const html = readFileSync(file, "utf8");
    if (!html.includes(NEXT_HTML_MARK)) continue;
    found++;
    const count = cspMetaCount(html);
    if (count !== 1) problems.push(`${path.relative(dir, file)}: ${what}의 HTML에 CSP meta가 ${count}개 — 1개여야 한다`);
  }
  return found;
}

/**
 * 플랫폼 어댑터가 만든 배포 산출물을 확인한다. Vercel 어댑터(@vercel/next)는 <distDir>/output에 Build Output을
 * 쓰고 정적 페이지 HTML을 functions/*.prerender-fallback.html로 복사한다(빌드가 끝나면 Vercel이 이 디렉터리를
 * 올린다). 서버 함수는 .next의 원본 파일을 가리키므로(filePathMap) 앞의 .next 확인이 그쪽을 맡는다.
 * 고친 페이지 수만큼 찾지 못하면 플랫폼이 HTML을 다른 곳에 두는 것이므로 실패시킨다.
 */
function verifyPlatformOutput(ctx, expected, problems) {
  const dir = path.join(ctx.distDir, "output");
  const found = existsSync(dir) ? checkHtmlTree(dir, "배포 산출물", problems) : 0;
  if (found < expected) {
    problems.push(
      `배포 산출물(${dir})에서 정적 HTML을 ${found}개만 찾았다(어댑터 출력의 정적 HTML ${expected}개) — ` +
        `플랫폼 어댑터가 HTML을 어디에 두는지 확인하고 verifyPlatformOutput을 고칠 것`,
    );
  }
  return { dir, found };
}

/** 배포 플랫폼이 지정한 어댑터 — Next가 하던 방식(next 패키지 위치에서 해석, default 우선)으로 불러온다 */
let platformLoad;
function platformAdapter() {
  platformLoad ??= (async () => {
    const spec = process.env.NEXT_ADAPTER_PATH;
    if (!spec) return null;
    const fromNext = createRequire(createRequire(import.meta.url).resolve("next/dist/server/config.js"));
    const resolved = fromNext.resolve(spec);
    if (resolved === SELF) return null;
    const mod = await import(pathToFileURL(resolved).href);
    return mod.default || mod;
  })();
  return platformLoad;
}

function fail(problems) {
  console.error(`\n${TAG} 실패 ${problems.length}건:`);
  for (const p of problems) console.error(`  - ${p}`);
  throw new Error(`${TAG} 정적 페이지 CSP 처리 실패 ${problems.length}건 — 위 목록 참고`);
}

/** @type {import("next").NextAdapter} */
const adapter = {
  name: "a11ychk-csp",

  async modifyConfig(config, ctx) {
    const platform = await platformAdapter();
    return typeof platform?.modifyConfig === "function" ? platform.modifyConfig(config, ctx) : config;
  },

  async onBuildComplete(ctx) {
    const platform = await platformAdapter();
    const problems = [];

    // 1. 플랫폼 어댑터가 HTML을 가져가기 전에 해시 meta를 넣는다
    const done = patchStaticPages(staticHtmlOutputs(ctx), process.env, problems);
    // 빠진 HTML이 없는지 — 서버 함수가 런타임에 읽는 .next/server의 HTML도 전부 meta가 있어야 한다
    checkHtmlTree(path.join(ctx.distDir, "server"), ".next/server", problems);
    if (problems.length > 0) fail(problems);
    console.log(`${TAG} 정적 HTML ${done.length}개에 해시 CSP를 넣었다 (괄호 안은 인라인 스크립트 수)`);
    console.log(`  ${done.map((d) => `${d.route} (${d.scripts})`).join(", ")}`);

    // 2. 플랫폼 어댑터(없으면 로컬·CI 빌드 — .next를 그대로 서빙한다)
    if (!platform) return;
    console.log(`${TAG} 플랫폼 어댑터 ${platform.name ?? "(이름 없음)"}에 넘긴다`);
    if (typeof platform.onBuildComplete === "function") await platform.onBuildComplete(ctx);

    // 3. 배포 산출물 확인
    // manifest에서 보충한 HTML(/_not-found)은 플랫폼이 복사하지 않으므로 어댑터 출력에서 온 것만 센다
    const { dir, found } = verifyPlatformOutput(ctx, done.filter((d) => d.shipped).length, problems);
    if (problems.length > 0) fail(problems);
    console.log(`${TAG} 배포 산출물의 정적 HTML ${found}개에 meta가 하나씩 있다 (${path.relative(ctx.projectDir, dir)})`);
  },
};

export default adapter;
