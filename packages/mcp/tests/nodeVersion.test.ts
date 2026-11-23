import { readFileSync } from "node:fs";
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

describe("MIN_NODE_VERSION", () => {
  it("package.json의 engines와 같다", () => {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
      engines: { node: string };
    };
    expect(pkg.engines.node).toBe(`>=${MIN_NODE_VERSION}`);
  });
});
