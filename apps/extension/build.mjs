import { build } from "esbuild";
import { readFileSync } from "node:fs";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const src = join(root, "src");
const dist = join(root, "dist");

const require = createRequire(import.meta.url);

const SITE_ORIGIN = process.env.A11YCHK_SITE_ORIGIN ?? "https://www.a11ychk.com";

// Supabase 공개값(URL·anon 키) — 확장이 세션 교환·갱신에 직접 쓴다. 환경변수가 없으면
// 웹 앱의 .env.local에서 같은 이름을 읽는다(둘 다 공개값이라 번들에 박아도 된다).
function readWebEnv(name) {
  try {
    const text = readFileSync(join(root, "..", "web", ".env.local"), "utf8");
    const m = text.match(new RegExp(`^${name}=(.*)$`, "m"));
    return m?.[1]?.trim().replace(/^["']|["']$/g, "");
  } catch {
    return undefined;
  }
}
const SUPABASE_URL = process.env.A11YCHK_SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? readWebEnv("NEXT_PUBLIC_SUPABASE_URL");
const SUPABASE_ANON_KEY =
  process.env.A11YCHK_SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? readWebEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");
if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  throw new Error("Supabase URL/anon 키가 없습니다 — A11YCHK_SUPABASE_URL·A11YCHK_SUPABASE_ANON_KEY(또는 NEXT_PUBLIC_*)를 설정하세요");
}

// axe는 워크스페이스 의존성(node_modules)에서 가져와 core와 버전 동기화.
// 압축본(axe.min.js)이 아니라 원본(axe.js)을 싣는다 — 웹스토어 심사가 압축본을 난독화
// 코드로 판정해 삭제 경고를 보냈다(코드 가독성 요구사항, 2026-10). 번들도 minify하지 않는다.
const axePath = require.resolve("axe-core/axe.js");
const AXE_VERSION = require(join(dirname(axePath), "package.json")).version;

// axe에 번들된 core-js의 Object.create 폴리필(require_object_create)에서 IE용 폴백을 걷어 낸다.
// 원본 그대로 실은 0.6.1도 웹스토어 심사가 이 폴백의 문자열 조립('java' + SCRIPT + ':',
// LT + SCRIPT + GT)을 난독화로 보고 거부했다(2026-10). Chrome에는 네이티브 Object.create가 있어
// 이 폴백은 실행되지 않으므로, 빈 프로토타입 객체는 Object.create(null)로 만들게 바꾸고 나머지
// axe 코드는 손대지 않는다(판정 로직 3면 일치). axe를 올려 원문이 달라지면 빌드를 멈춘다.
const AXE_IE_FALLBACK = `      var GT = '>';
      var LT = '<';
      var PROTOTYPE = 'prototype';
      var SCRIPT = 'script';
      var IE_PROTO = sharedKey('IE_PROTO');
      var EmptyConstructor = function EmptyConstructor() {};
      var scriptTag = function scriptTag(content) {
        return LT + SCRIPT + GT + content + LT + '/' + SCRIPT + GT;
      };
      var NullProtoObjectViaActiveX = function NullProtoObjectViaActiveX(activeXDocument2) {
        activeXDocument2.write(scriptTag(''));
        activeXDocument2.close();
        var temp = activeXDocument2.parentWindow.Object;
        activeXDocument2 = null;
        return temp;
      };
      var NullProtoObjectViaIFrame = function NullProtoObjectViaIFrame() {
        var iframe = documentCreateElement('iframe');
        var JS = 'java' + SCRIPT + ':';
        var iframeDocument;
        iframe.style.display = 'none';
        html.appendChild(iframe);
        iframe.src = String(JS);
        iframeDocument = iframe.contentWindow.document;
        iframeDocument.open();
        iframeDocument.write(scriptTag('document.F=Object'));
        iframeDocument.close();
        return iframeDocument.F;
      };
      var activeXDocument;
      var _NullProtoObject = function NullProtoObject() {
        try {
          activeXDocument = new ActiveXObject('htmlfile');
        } catch (error) {}
        _NullProtoObject = typeof document != 'undefined' ? document.domain && activeXDocument ? NullProtoObjectViaActiveX(activeXDocument) : NullProtoObjectViaIFrame() : NullProtoObjectViaActiveX(activeXDocument);
        var length = enumBugKeys.length;
        while (length--) {
          delete _NullProtoObject[PROTOTYPE][enumBugKeys[length]];
        }
        return _NullProtoObject();
      };
`;
const AXE_NULL_PROTO = `      var PROTOTYPE = 'prototype';
      var IE_PROTO = sharedKey('IE_PROTO');
      var EmptyConstructor = function EmptyConstructor() {};
      // a11ychk build: removed the IE-only core-js fallbacks for null-prototype objects.
      // Chrome has a native Object.create, so this function is never reached there.
      var _NullProtoObject = function NullProtoObject() {
        return Object.create(null);
      };
`;
const AXE_FORBIDDEN = ["'java' + SCRIPT", "ActiveXObject", "scriptTag", "LT + SCRIPT"];

function stripAxeIeFallback(source) {
  const moduleStart = source.indexOf("var require_object_create = __commonJS(");
  const moduleEnd = source.indexOf("var require_", moduleStart + 1);
  const at = source.indexOf(AXE_IE_FALLBACK, moduleStart);
  if (moduleStart < 0 || at < 0 || at > moduleEnd || source.indexOf(AXE_IE_FALLBACK, at + 1) >= 0) {
    throw new Error(`axe v${AXE_VERSION}의 require_object_create에서 예상한 IE 폴백 원문을 찾지 못했습니다 — build.mjs의 AXE_IE_FALLBACK을 새 원문에 맞추세요`);
  }
  const out = source.slice(0, at) + AXE_NULL_PROTO + source.slice(at + AXE_IE_FALLBACK.length);
  const left = AXE_FORBIDDEN.filter((s) => out.includes(s));
  if (left.length > 0) {
    throw new Error(`변환한 axe.js에 심사 지적 문자열이 남아 있습니다: ${left.join(", ")}`);
  }
  return out;
}

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });

// TypeScript 엔트리 번들 (사이드 패널 · 콘텐츠 스크립트 · 서비스 워커)
// target chrome114: Side Panel API 요구 버전
await build({
  entryPoints: {
    sidepanel: join(src, "sidepanel.ts"),
    "content-connect": join(src, "content-connect.ts"),
    background: join(src, "background.ts"),
  },
  bundle: true,
  format: "iife",
  target: "chrome114",
  outdir: dist,
  define: {
    "process.env.A11YCHK_SITE_ORIGIN": JSON.stringify(SITE_ORIGIN),
    "process.env.A11YCHK_AXE_VERSION": JSON.stringify(AXE_VERSION),
    "process.env.A11YCHK_SUPABASE_URL": JSON.stringify(SUPABASE_URL),
    "process.env.A11YCHK_SUPABASE_ANON_KEY": JSON.stringify(SUPABASE_ANON_KEY),
  },
  loader: { ".css": "text" },
});

// 정적 파일 복사 (manifest, 패널 HTML/CSS, 아이콘) + axe (node_modules에서 — 벤더 드리프트 방지)
for (const f of ["manifest.json", "sidepanel.html", "sidepanel.css"]) {
  await cp(join(src, f), join(dist, f));
}
await mkdir(join(dist, "vendor"), { recursive: true });
await writeFile(join(dist, "vendor", "axe.js"), stripAxeIeFallback(await readFile(axePath, "utf8")));
await cp(join(src, "icons"), join(dist, "icons"), { recursive: true });
await cp(join(src, "_locales"), join(dist, "_locales"), { recursive: true });

console.log(`✓ 확장 빌드 완료 → apps/extension/dist (site: ${SITE_ORIGIN}, axe: v${AXE_VERSION})`);
