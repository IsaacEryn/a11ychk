import Link from "next/link";

/**
 * 루트 not-found — 로케일 프리픽스 밖(예: 잘못된 최상위 경로)의 미매칭에 대응한다.
 * 로케일 레이아웃(provider·globals.css) 밖에서 렌더되므로 자체 <style> + ko/en 병기.
 * 색상은 globals.css의 라이트/다크 토큰과 동일 hex(대비 4.5:1 검증쌍)만 차용한다.
 */
const styles = `
.rnf {
  min-height: 60vh;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.75rem;
  padding: 4rem 1.5rem;
  text-align: center;
  font-family: system-ui, -apple-system, 'Apple SD Gothic Neo', sans-serif;
  color: #1c2422;
  background: #faf8f3;
}
.rnf-code { font-size: 3.5rem; font-weight: 800; color: #d9d2c3; margin: 0; }
.rnf h1 { font-size: 1.4rem; font-weight: 700; margin: 0; }
.rnf-desc { color: #5d6a66; line-height: 1.6; margin: 0; }
.rnf-home {
  margin-top: 0.5rem;
  border: 1.5px solid #0b5d54;
  background: #0b5d54;
  color: #fff;
  font-weight: 700;
  padding: 0.6rem 1.4rem;
  border-radius: 6px;
  text-decoration: none;
}
@media (prefers-color-scheme: dark) {
  .rnf { color: #eef0ea; background: #14201d; }
  .rnf-code { color: #33443f; }
  .rnf-desc { color: #9dada5; }
  .rnf-home { border-color: #58c0ae; background: #58c0ae; color: #14201d; }
}
`;

export default function RootNotFound() {
  return (
    <main className="rnf">
      <style>{styles}</style>
      <p className="rnf-code" aria-hidden="true">
        404
      </p>
      <h1>페이지를 찾을 수 없습니다 · Page not found</h1>
      <p className="rnf-desc">
        주소가 바뀌었거나 삭제된 페이지입니다.
        <br />
        The page may have moved or been removed.
      </p>
      <Link href="/" className="rnf-home">
        홈으로 · Home
      </Link>
    </main>
  );
}
