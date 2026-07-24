import { describe, expect, it } from "vitest";
import { assessLoginRisk, deviceFingerprint } from "@/lib/security/loginRisk";

const CHROME_MAC =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";
const SAFARI_IOS =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const EDGE_WIN =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0";

describe("deviceFingerprint — 브라우저·OS 계열만 (버전 업데이트로 오탐 방지)", () => {
  it("Chrome/macOS·Safari/iOS·Edge/Windows를 구분한다", () => {
    expect(deviceFingerprint(CHROME_MAC)).toBe("Chrome/macOS");
    expect(deviceFingerprint(SAFARI_IOS)).toBe("Safari/iOS");
    expect(deviceFingerprint(EDGE_WIN)).toBe("Edge/Windows");
  });

  it("같은 브라우저의 버전만 다르면 같은 지문", () => {
    expect(deviceFingerprint(CHROME_MAC.replace("140.0.0.0", "141.0.0.0"))).toBe(deviceFingerprint(CHROME_MAC));
  });

  it("UA가 없으면 unknown", () => {
    expect(deviceFingerprint(null)).toBe("unknown");
    expect(deviceFingerprint(undefined)).toBe("unknown");
  });
});

describe("assessLoginRisk — 이상 징후 판정", () => {
  const known = { knownIps: ["1.1.1.1"], knownDevices: ["Chrome/macOS"] };

  it("익숙한 IP·기기에 실패 없음 → 알림 없음", () => {
    expect(assessLoginRisk({ ip: "1.1.1.1", device: "Chrome/macOS", ...known, recentFailures: 0 })).toEqual([]);
  });

  it("처음 보는 IP → newIp", () => {
    expect(assessLoginRisk({ ip: "9.9.9.9", device: "Chrome/macOS", ...known, recentFailures: 0 })).toEqual(["newIp"]);
  });

  it("처음 보는 기기 → newDevice", () => {
    expect(assessLoginRisk({ ip: "1.1.1.1", device: "Safari/iOS", ...known, recentFailures: 0 })).toEqual([
      "newDevice",
    ]);
  });

  it("최근 MFA 실패가 임계 이상이면 → recentFailures (익숙한 환경이어도)", () => {
    expect(assessLoginRisk({ ip: "1.1.1.1", device: "Chrome/macOS", ...known, recentFailures: 2 })).toEqual([
      "recentFailures",
    ]);
    expect(assessLoginRisk({ ip: "1.1.1.1", device: "Chrome/macOS", ...known, recentFailures: 1 })).toEqual([]);
  });

  it("여러 신호는 함께 보고된다", () => {
    expect(assessLoginRisk({ ip: "9.9.9.9", device: "Safari/iOS", ...known, recentFailures: 3 })).toEqual([
      "newIp",
      "newDevice",
      "recentFailures",
    ]);
  });

  it("이력이 없으면 새 IP·기기로 보지 않는다 (첫 로그인에 늑대 소년 방지)", () => {
    expect(
      assessLoginRisk({ ip: "9.9.9.9", device: "Safari/iOS", knownIps: [], knownDevices: [], recentFailures: 0 }),
    ).toEqual([]);
  });

  it("이력이 없어도 실패 누적은 경보한다", () => {
    expect(
      assessLoginRisk({ ip: "9.9.9.9", device: "Safari/iOS", knownIps: [], knownDevices: [], recentFailures: 2 }),
    ).toEqual(["recentFailures"]);
  });

  it("IP를 못 얻으면(프록시 등) newIp로 판정하지 않는다", () => {
    expect(assessLoginRisk({ ip: null, device: "Chrome/macOS", ...known, recentFailures: 0 })).toEqual([]);
  });
});
