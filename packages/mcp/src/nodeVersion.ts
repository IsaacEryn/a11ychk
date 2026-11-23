/**
 * 서버를 띄울 수 있는 가장 낮은 Node.js 버전(메이저.마이너). package.json의 engines와 같아야
 * 하고, 어긋나면 테스트가 잡는다. 근거는 package.json의 "//engines"에 있다.
 */
export const MIN_NODE_VERSION = "22.19";

/** "22.13.1", "v22.13.1", "25.0.0-nightly…"에서 메이저와 마이너를 읽는다. 못 읽으면 null */
function majorMinor(version: string): [number, number] | null {
  const m = /^v?(\d+)\.(\d+)/.exec(version);
  return m ? [Number(m[1]), Number(m[2])] : null;
}

/**
 * 지금 Node.js로 서버를 띄울 수 없으면 안내문(첫 줄 한국어, 둘째 줄 영어)을, 띄울 수 있으면
 * null을 돌려준다. 버전 문자열을 읽지 못하면 막지 않는다.
 */
export function unsupportedNodeMessage(current: string): string | null {
  const have = majorMinor(current);
  const need = majorMinor(MIN_NODE_VERSION);
  if (!have || !need) return null;
  if (have[0] > need[0] || (have[0] === need[0] && have[1] >= need[1])) return null;

  const shown = current.replace(/^v/, "");
  return [
    `@a11ychk/mcp: Node.js ${MIN_NODE_VERSION} 이상이 필요합니다. 지금 버전은 ${shown}입니다. Node.js를 올린 뒤 다시 실행해 주세요.`,
    `@a11ychk/mcp requires Node.js ${MIN_NODE_VERSION} or later. You are running ${shown}. Upgrade Node.js and run it again.`,
  ].join("\n");
}
