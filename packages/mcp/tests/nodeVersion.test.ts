import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { MIN_NODE_VERSION, unsupportedNodeMessage } from "../src/nodeVersion";

describe("unsupportedNodeMessage", () => {
  it.each(["22.19.0", "22.19.1", "22.20.0", "23.0.0", "24.7.0"])("Node %s은 지원한다", (version) => {
    expect(unsupportedNodeMessage(version)).toBeNull();
  });

  it.each(["22.18.0", "22.13.1", "22.0.0", "20.18.0", "18.20.4"])("Node %s은 지원하지 않는다", (version) => {
    expect(unsupportedNodeMessage(version)).not.toBeNull();
  });

  // 숫자가 아니라 문자열로 견주면 22.9가 22.19보다 크게 나온다
  it("마이너 버전은 숫자로 견준다", () => {
    expect(unsupportedNodeMessage("22.9.0")).not.toBeNull();
    expect(unsupportedNodeMessage("22.100.0")).toBeNull();
  });

  it("안내문은 필요한 버전과 지금 버전을 한국어와 영어로 알린다", () => {
    const message = unsupportedNodeMessage("22.13.1") ?? "";
    const [ko, en] = message.split("\n");
    expect(ko).toContain("Node.js 22.19 이상이 필요합니다");
    expect(ko).toContain("22.13.1");
    expect(en).toContain("requires Node.js 22.19 or later");
    expect(en).toContain("22.13.1");
  });

  it("앞에 v가 붙은 버전 문자열도 읽는다", () => {
    expect(unsupportedNodeMessage("v22.13.1")).not.toBeNull();
    expect(unsupportedNodeMessage("v24.7.0")).toBeNull();
  });

  it("시험판 꼬리표가 붙어도 숫자 부분으로 판정한다", () => {
    expect(unsupportedNodeMessage("25.0.0-nightly20261101abcdef")).toBeNull();
    expect(unsupportedNodeMessage("22.18.0-rc.1")).not.toBeNull();
  });

  // 버전을 읽지 못했다고 서버를 막으면 Node 호환 런타임에서 쓸 길이 없어진다
  it.each(["", "abc", "22"])("읽지 못한 버전 문자열 %j은 막지 않는다", (version) => {
    expect(unsupportedNodeMessage(version)).toBeNull();
  });
});

/** ">=22.19.0" 같은 engines 값에서 하한의 메이저와 마이너를 읽는다 */
function lowerBound(range: string): [number, number] {
  const m = /^>=\s*(\d+)(?:\.(\d+))?/.exec(range);
  if (!m) throw new Error(`읽을 수 없는 engines 값: ${range}`);
  return [Number(m[1]), Number(m[2] ?? 0)];
}

function readJson(path: string | URL): { engines: { node: string } } {
  return JSON.parse(readFileSync(path, "utf8")) as { engines: { node: string } };
}

describe("MIN_NODE_VERSION", () => {
  // 서버가 22.19 아래에서 뜨지 못하는 것은 undici 때문이다. undici를 올려 요구 버전이 바뀌면 여기서 걸린다.
  it("undici가 요구하는 Node.js 버전보다 낮지 않다", () => {
    const undiciDir = dirname(createRequire(import.meta.url).resolve("undici"));
    const [needMajor, needMinor] = lowerBound(readJson(join(undiciDir, "package.json")).engines.node);
    const [major, minor] = lowerBound(`>=${MIN_NODE_VERSION}`);
    expect(major > needMajor || (major === needMajor && minor >= needMinor)).toBe(true);
  });
});

describe("package.json의 engines", () => {
  // npm은 지금 Node.js에 engines가 맞는 버전을 먼저 고른다. engines를 실제 요구 버전만큼 높이면
  // 낮은 Node.js의 npx는 engines가 >=20인 옛 0.1.2를 받아 오고, 진입점의 안내는 실행되지 않는다.
  it("옛 0.1.2가 골라지던 Node.js 20부터 받아들인다", () => {
    const [major, minor] = lowerBound(readJson(new URL("../package.json", import.meta.url)).engines.node);
    expect(major < 20 || (major === 20 && minor === 0)).toBe(true);
  });
});
