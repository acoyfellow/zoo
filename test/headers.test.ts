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

  expect(policy).toContain("script-src 'self'");
  expect(policy).toContain("img-src 'self' blob: data:");
  expect(policy).toContain("connect-src 'self' wss://zoo.coey.dev");
  expect(policy).not.toContain("unsafe-eval");
});
