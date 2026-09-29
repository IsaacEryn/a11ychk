import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { localFetch } from "../src/crawler/localFetch";

let server: Server;
let base = "";

beforeAll(async () => {
  server = createServer((req, res) => {
    const redirect = (location: string) => {
      res.writeHead(302, { location });
      res.end();
    };
    switch (req.url) {
      case "/a":
        return redirect("/b");
      case "/b":
        return res.end("b");
      case "/utf8":
        // "/한글"을 퍼센트 인코딩 없이 UTF-8 바이트 그대로 보내는 사이트 흉내
        return redirect(Buffer.from("/한글").toString("latin1"));
      case "/%ED%95%9C%EA%B8%80":
        return res.end("한글");
      case "/bad":
        return redirect("http://%EA%B0%80xn--.invalid/next");
      case "/loop":
        return redirect("/loop");
      case "/ftp":
        return redirect("ftp://example.com/");
      case "/no-location":
        res.writeHead(302);
        return res.end();
      default:
        res.writeHead(404);
        return res.end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

describe("localFetch — 리다이렉트를 직접 따라가는 로컬 도구용 fetch", () => {
  it("리다이렉트를 따라가 최종 응답과 그 주소를 돌려준다", async () => {
    const res = await localFetch(`${base}/a`);
    expect(res.status).toBe(200);
    expect(res.url).toBe(`${base}/b`);
    expect(await res.text()).toBe("b");
  });

  it("UTF-8 원문 Location은 브라우저처럼 UTF-8로 읽어 따라간다", async () => {
    const res = await localFetch(`${base}/utf8`);
    expect(res.url).toBe(`${base}/%ED%95%9C%EA%B8%80`);
    expect(await res.text()).toBe("한글");
  });

  // undici의 자동 추적은 Location으로 만든 URL에 hash setter를 부르는데, ada 3.x(Node 24.7·25.6)에서
  // 다시 해석되지 않는 href면 그 자리에서 프로세스가 abort된다. 어느 런타임에서든 거절로 끝나야 한다.
  it("다시 해석되지 않는 주소로의 리다이렉트는 프로세스를 죽이지 않고 거절한다", async () => {
    await expect(localFetch(`${base}/bad`)).rejects.toThrow();
  });

  it("리다이렉트가 20번을 넘으면 거절한다", async () => {
    await expect(localFetch(`${base}/loop`)).rejects.toThrow();
  });

  it("http(s)가 아닌 주소로의 리다이렉트는 거절한다", async () => {
    await expect(localFetch(`${base}/ftp`)).rejects.toThrow();
  });

  it("Location 없는 3xx는 그대로 돌려준다", async () => {
    expect((await localFetch(`${base}/no-location`)).status).toBe(302);
  });
});
