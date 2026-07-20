"use client";

/**
 * 루트 레이아웃 자체가 실패했을 때의 최후 경계 — 로케일 provider·전역 CSS가 없으므로
 * 자체 <html>/<body>와 인라인 스타일로 최소한의 안내만 렌더한다. ko/en 병기.
 */
export default function GlobalError({ reset }: { reset: () => void }) {
  return (
    <html lang="ko">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "system-ui, -apple-system, sans-serif",
          background: "#faf8f4",
          color: "#1c1a17",
        }}
      >
        <main style={{ maxWidth: 420, padding: "2rem", textAlign: "center" }}>
          <h1 style={{ fontSize: "1.4rem", margin: "0 0 0.5rem" }}>
            문제가 발생했습니다 · Something went wrong
          </h1>
          <p style={{ margin: "0 0 1.5rem", color: "#5c574f", lineHeight: 1.6 }}>
            일시적인 오류입니다. 잠시 후 다시 시도해 주세요.
            <br />
            A temporary error occurred. Please try again.
          </p>
          <button
            type="button"
            onClick={reset}
            style={{
              border: "1.5px solid #0b5d54",
              background: "#0b5d54",
              color: "#fff",
              fontWeight: 700,
              padding: "0.6rem 1.4rem",
              borderRadius: 6,
              cursor: "pointer",
            }}
          >
            다시 시도 · Try again
          </button>
        </main>
      </body>
    </html>
  );
}
