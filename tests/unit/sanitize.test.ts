import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { capMessage, isOwnDomainUrl, safeUrl, sanitizeText } from "../../src/sanitize.ts";

const wellFormed = (s: string) => !/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/.test(s);

describe("sanitizeText", () => {
  test("strips tags and stray angle brackets", () => {
    assert.equal(sanitizeText("Bike <b>Pro</b><script>alert(1)</script> a<b"), "Bike Pro ab");
    assert.equal(sanitizeText("<\u200bb>x"), "x");
  });
  test("drops script and style elements with their content, even unclosed", () => {
    assert.equal(sanitizeText("a<script>alert(1)</script>b<STYLE>x{}</style >c<script>evil"), "a b c");
  });
  test("strips C0/C1 controls and DEL, turns newlines and tabs into single spaces", () => {
    assert.equal(sanitizeText("a\u0007\u0001b\u007f\u0085c\n\t d\r\ne"), "abc d e");
  });
  test("strips bidi overrides, isolates and marks", () => {
    assert.equal(sanitizeText("a\u202eb\u202ac\u202d\u2066d\u2069e\u200ff\u200e\u061cg"), "abcdefg");
  });
  test("strips zero-width characters and BOM", () => {
    assert.equal(sanitizeText("a\u200bb\u200cc\u200dd\u2060e\ufefff\u00adg"), "abcdefg");
  });
  test("collapses whitespace including NBSP and line separators", () => {
    assert.equal(sanitizeText("  a \u00a0 b\u2028c  "), "a b c");
  });
  test("caps very long text at max characters, ending with an ellipsis", () => {
    const out = sanitizeText("x".repeat(5000), 120);
    assert.equal(Array.from(out).length, 120);
    assert.ok(out.endsWith("…"));
  });
  test("text at exactly max is unchanged", () => {
    assert.equal(sanitizeText("x".repeat(120), 120), "x".repeat(120));
  });
  test("never splits a surrogate pair at the cut point", () => {
    for (let n = 0; n < 4; n++) {
      const out = sanitizeText("a".repeat(n) + "😀".repeat(10), 5);
      assert.ok(wellFormed(out));
      assert.ok(Array.from(out).length <= 5);
    }
  });
  test("lone surrogates are replaced", () => {
    assert.equal(sanitizeText("a\uD800b"), "a\uFFFDb");
  });
  test("hostile text that is only markup becomes empty", () => {
    assert.equal(sanitizeText("<img src=x onerror=alert(1)>"), "");
  });
});

describe("isOwnDomainUrl", () => {
  const watch = ["https://www.rosebikes.com/bikes"];
  test("same host, www-less host and subdomains are own", () => {
    assert.equal(isOwnDomainUrl("https://www.rosebikes.com/p/1", watch), true);
    assert.equal(isOwnDomainUrl("https://rosebikes.com/p/1", watch), true);
    assert.equal(isOwnDomainUrl("https://de.rosebikes.com/p/1", watch), true);
    assert.equal(isOwnDomainUrl("http://de.aliexpress.com/x", ["https://www.aliexpress.com/w"]), true);
  });
  test("lookalike and foreign hosts are not own", () => {
    for (const u of [
      "https://rosebikes.com.evil.net/",
      "https://evilrosebikes.com/",
      "https://evil.example/rosebikes.com",
      "https://rosebikes.com@evil.example/",
      "https://www.rosebikes.com@evil.example/",
    ]) {
      assert.equal(isOwnDomainUrl(u, watch), false, u);
    }
  });
  test("only http and https, no credentials, not garbage", () => {
    for (const u of [
      "javascript:alert(1)",
      "data:text/html,x",
      "ftp://www.rosebikes.com/",
      "https://user:pw@www.rosebikes.com/",
      "not a url",
      "",
    ]) {
      assert.equal(isOwnDomainUrl(u, watch), false, u);
    }
  });
  test("a more specific watch host does not allow its parent", () => {
    assert.equal(isOwnDomainUrl("https://example.com/", ["https://shop.example.com/"]), false);
  });
  test("host case is ignored; any of several watch URLs counts", () => {
    assert.equal(isOwnDomainUrl("https://WWW.ROSEBIKES.COM/x", watch), true);
    assert.equal(isOwnDomainUrl("https://b.test/x", ["https://a.test/", "https://b.test/"]), true);
  });
});

describe("safeUrl", () => {
  const watch = ["http://shop.test/list"];
  test("keeps an own-domain link, replaces others by the first watch URL", () => {
    assert.equal(safeUrl("http://shop.test/p/1", watch), "http://shop.test/p/1");
    assert.equal(safeUrl("https://evil.example/", watch), "http://shop.test/list");
    assert.equal(safeUrl("javascript:alert(1)", watch), "http://shop.test/list");
  });
  test("an absurdly long link is replaced rather than cut", () => {
    assert.equal(safeUrl(`http://shop.test/${"a".repeat(600)}`, watch), "http://shop.test/list");
  });
  test("control characters in the URL cause replacement", () => {
    assert.equal(safeUrl("http://shop.test/a\u0007b", watch), "http://shop.test/list");
  });
});

describe("capMessage", () => {
  test("short text unchanged", () => assert.equal(capMessage("hi\n"), "hi\n"));
  test("long text is cut to 3500 with an ellipsis", () => {
    const out = capMessage("x".repeat(9000));
    assert.equal(out.length, 3500);
    assert.ok(out.endsWith("…"));
  });
  test("does not split a surrogate pair", () => {
    const out = capMessage("x".repeat(3498) + "😀😀");
    assert.ok(out.length <= 3500);
    assert.ok(wellFormed(out));
  });
});
