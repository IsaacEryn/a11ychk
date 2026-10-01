import { describe, expect, it } from "vitest";
import { funnelUrl } from "../src/funnel";

/** 딥링크의 url 파라미터 — 웹 검사 폼에 미리 채워질 주소 (싣지 않았으면 null) */
const prefill = (scanned: string) => new URL(funnelUrl("ko", "scan", scanned)).searchParams.get("url");

describe("funnelUrl", () => {
  it("도메인 주소는 자격증명을 뺀 채 url 파라미터로 싣는다", () => {
    expect(prefill("https://user:pw@example.com/a")).toBe("https://example.com/a");
  });

  it("일반 IDN 호스트는 퓨니코드로 싣는다", () => {
    expect(prefill("http://한글.com/")).toBe("http://xn--bj0bj06e.com/");
  });

  it("끝에 점이 붙은 공개 도메인(FQDN 표기)도 싣는다", () => {
    expect(prefill("https://example.com./a")).toBe("https://example.com./a");
  });

  it("공개 IP 리터럴은 그대로 싣는다", () => {
    expect(prefill("https://8.8.8.8/a")).toBe("https://8.8.8.8/a");
    expect(prefill("http://[2001:4860::8888]/")).toBe("http://[2001:4860::8888]/");
  });

  // 웹 서비스가 검사할 수 없는 주소다. 내부 호스트 이름이나 로컬 경로가 외부로 나가는 링크에 실리면 안 된다.
  it.each([
    "http://localhost:3000/",
    "http://app.localhost/",
    "http://printer.local/",
    "http://metadata.google.internal/computeMetadata/v1/",
    "http://localhost./",
    "http://printer.local./",
    "http://devbox:3000/",
    "http://intranet/wiki",
    "http://127.0.0.1:8080/",
    "http://10.0.0.1/",
    "http://192.168.0.10/",
    "http://169.254.169.254/latest/meta-data/",
    "http://[::1]/",
    "http://[::ffff:10.0.0.1]/",
    "http://[fe80::1]/",
    "file:///Users/me/site/index.html",
  ])("내부 주소는 싣지 않는다: %s", (raw) => {
    expect(prefill(raw)).toBeNull();
  });

  // ada 3.x(Node 24.7·25.6 등)는 이런 호스트로 만든 href를 스스로 다시 해석하지 못하고, 그 URL에
  // setter를 부르면 프로세스가 abort된다(try/catch로 못 잡는다). scan_page는 사용자가 넘긴 주소로
  // 결과 말미 안내를 만들므로 MCP 서버째 죽는다. 기대값은 런타임을 따른다 — href가 다시 해석되는
  // Node 22 등에선 ASCII 주소 그대로, 아니면 null.
  it("다시 해석되지 않는 href는 setter 전에 거른다", () => {
    const ascii = "http://xn--xn---9g3p.com/";
    expect(prefill("http://가xn--.com/")).toBe(URL.canParse(ascii) ? ascii : null);
  });
});
