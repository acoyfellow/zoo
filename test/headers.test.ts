import { expect, test } from "bun:test";
import { contentSecurityPolicy, withSecurityHeaders } from "../src/front/headers";

test("front responses carry CSP, nosniff, and referrer policy", () => {
  const secured = withSecurityHeaders(new Response("ok"), "zoo.coey.dev");

  expect(secured.headers.get("X-Content-Type-Options")).toBe("nosniff");
  expect(secured.headers.get("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
  expect(secured.headers.get("Content-Security-Policy")).toBe(contentSecurityPolicy("zoo.coey.dev"));
});

test("CSP allows only self scripts, blob and data images, and the world socket", () => {
  const policy = contentSecurityPolicy("zoo.coey.dev");

  expect(policy).toContain("script-src 'self' https://static.cloudflareinsights.com");
  expect(policy).toContain("img-src 'self' blob: data:");
  expect(policy).toContain("connect-src 'self' wss://zoo.coey.dev https://cloudflareinsights.com");
  expect(policy).not.toContain("unsafe-eval");
});

test("static asset _headers match the Worker policy", async () => {
  const file = await Bun.file("src/web/public/_headers").text();

  expect(file).toContain(`Content-Security-Policy: ${contentSecurityPolicy("zoo.coey.dev")}`);
  expect(file).toContain("X-Content-Type-Options: nosniff");
  expect(file).toContain("Referrer-Policy: strict-origin-when-cross-origin");
});
