import Link from "next/link";

/**
 * 루트 not-found — 로케일 프리픽스 밖(예: 잘못된 최상위 경로)의 미매칭에 대응한다.
 * 로케일 레이아웃(provider·globals.css) 밖에서 렌더되므로 인라인 스타일 + ko/en 병기.
 */
export default function RootNotFound() {
  return (
    <main
      style={{
        minHeight: "60vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: "0.75rem",
        padding: "4rem 1.5rem",
        textAlign: "center",
        fontFamily: "system-ui, -apple-system, 'Apple SD Gothic Neo', sans-serif",
        color: "#1c2422",
        background: "#faf8f3",
      }}
    >
      <p style={{ fontSize: "3.5rem", fontWeight: 800, color: "#d9d2c3", margin: 0 }} aria-hidden="true">
        404
      </p>
      <h1 style={{ fontSize: "1.4rem", fontWeight: 700, margin: 0 }}>
        페이지를 찾을 수 없습니다 · Page not found
      </h1>
      <p style={{ color: "#5d6a66", lineHeight: 1.6, margin: 0 }}>
        주소가 바뀌었거나 삭제된 페이지입니다.
        <br />
        The page may have moved or been removed.
      </p>
      <Link
        href="/"
        style={{
          marginTop: "0.5rem",
          border: "1.5px solid #0b5d54",
          background: "#0b5d54",
          color: "#fff",
          fontWeight: 700,
          padding: "0.6rem 1.4rem",
          borderRadius: 6,
          textDecoration: "none",
        }}
      >
        홈으로 · Home
      </Link>
    </main>
  );
}
