/**
 * stdout 보호 — 이 모듈은 server.ts의 **첫 import**여야 한다.
 *
 * stdout은 JSON-RPC 채널이라 한 줄이라도 섞이면 프로토콜이 깨진다. server.ts 본문
 * 맨 위에 리바인드를 적어도 ESM은 import를 먼저 평가하므로 의존성 로딩 시점에는
 * 적용되지 않는다. 별도 모듈로 빼서 첫 import로 두면 번들러가 이 파일을 다른
 * 의존성보다 앞에 놓는다.
 *
 * console.warn·error는 Node에서 이미 stderr이므로 건드리지 않는다.
 */
console.log = console.error;
console.info = console.error;
console.debug = console.error;

export {};
