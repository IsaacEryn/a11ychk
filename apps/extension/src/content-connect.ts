/**
 * a11ychk.com/{locale}/extension/connect 페이지에서 실행되는 콘텐츠 스크립트.
 * 로그인된 사용자의 연결 페이지가 렌더한 세션 페이로드(#a11ychk-ext-payload)를 읽어
 * 확장 저장소에 보관한다. 페이지에는 확장 ID를 노출하지 않아도 되는 안전한 방식.
 */
interface ExtPayload {
  accessToken: string;
  expiresAt: number;
  email?: string;
}

function readPayload(): ExtPayload | null {
  const el = document.getElementById("a11ychk-ext-payload");
  if (!el?.textContent) return null;
  try {
    const p = JSON.parse(el.textContent) as ExtPayload;
    if (p.accessToken && typeof p.expiresAt === "number") return p;
  } catch {
    // 무시
  }
  return null;
}

async function sync() {
  const payload = readPayload();
  const status = document.getElementById("a11ychk-ext-status");
  if (!payload) return;
  await chrome.storage.local.set({
    a11ychk_session: {
      accessToken: payload.accessToken,
      expiresAt: payload.expiresAt,
      email: payload.email,
    },
  });
  if (status) status.textContent = "connected";
  // 페이지가 확장 설치·연결 완료를 감지할 수 있도록 이벤트 발생
  document.dispatchEvent(new CustomEvent("a11ychk-ext-connected"));
}

// 페이지의 세션 로드는 비동기이므로: 즉시 한 번 시도 + 준비 이벤트 수신 + 짧은 폴백 폴링
void sync();
document.addEventListener("a11ychk-ext-payload-ready", () => void sync());
let tries = 0;
const timer = setInterval(() => {
  tries += 1;
  if (readPayload() || tries > 20) {
    clearInterval(timer);
    void sync();
  }
}, 500);
