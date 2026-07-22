"use client";

/**
 * 루트 레이아웃 자체가 실패했을 때의 최후 경계 — 로케일 provider·전역 CSS가 없으므로
 * 자체 <html>/<body>와 <style>로 최소한의 안내만 렌더한다. ko/en 병기.
 * 색상은 globals.css의 라이트/다크 토큰과 동일 hex(대비 4.5:1 검증쌍)만 차용한다.
 */
const styles = `
.gerr-body {
  margin: 0;
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: system-ui, -apple-system, sans-serif;
  background: #faf8f4;
  color: #1c1a17;
}
.gerr-main { max-width: 420px; padding: 2rem; text-align: center; }
.gerr-main h1 { font-size: 1.4rem; margin: 0 0 0.5rem; }
.gerr-desc { margin: 0 0 1.5rem; color: #5c574f; line-height: 1.6; }
.gerr-retry {
  border: 1.5px solid #0b5d54;
  background: #0b5d54;
  color: #fff;
  font-weight: 700;
  padding: 0.6rem 1.4rem;
  border-radius: 6px;
  cursor: pointer;
}
@media (prefers-color-scheme: dark) {
  .gerr-body { background: #14201d; color: #eef0ea; }
  .gerr-desc { color: #9dada5; }
  .gerr-retry { border-color: #58c0ae; background: #58c0ae; color: #14201d; }
}
`;

export default function GlobalError({ reset }: { reset: () => void }) {
  return (
    <html lang="ko">
      <body className="gerr-body">
        <style>{styles}</style>
        <main className="gerr-main">
          <h1>문제가 발생했습니다 · Something went wrong</h1>
          <p className="gerr-desc">
            일시적인 오류입니다. 잠시 후 다시 시도해 주세요.
            <br />
            A temporary error occurred. Please try again.
          </p>
          <button type="button" onClick={reset} className="gerr-retry">
            다시 시도 · Try again
          </button>
        </main>
      </body>
    </html>
  );
}
