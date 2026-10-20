/** Hardening for untrusted page text and links (REQ-008). Pure functions, shared by all extractors and messages. */

export const MAX_NAME = 120;
export const MAX_MESSAGE = 3500;
const MAX_URL = 500;

// C0 (except whitespace, handled first), DEL, C1, soft hyphen, Arabic letter mark, zero-width chars and marks
// (U+200B-U+200F), bidi embeddings/overrides (U+202A-U+202E), word joiner and invisible operators (U+2060-U+2064),
// bidi isolates (U+2066-U+2069), BOM.
// eslint-disable-next-line no-control-regex
const INVISIBLE = /[\u0000-\u001f\u007f-\u009f\u00ad\u061c\u200b-\u200f\u202a-\u202e\u2060-\u2064\u2066-\u2069\ufeff]/g;
const LONE_SURROGATE = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g;
// Untrusted input is bounded before any scan, so work stays linear in a small constant.
const MAX_INPUT = 20000;

/**
 * Single-pass markup stripper, linear in the input (no regex rescans). A tag becomes a space; script/style elements
 * are dropped with their content; an unclosed script/style drops the rest; a "<" without any later ">" is just removed.
 */
function stripMarkup(s: string): string {
  const lower = s.toLowerCase();
  let out = "";
  let i = 0;
  let noMoreClose = false; // once indexOf(">") fails there is no ">" further on, never search again
  while (i < s.length) {
    const lt = s.indexOf("<", i);
    if (lt === -1) {
      out += s.slice(i);
      break;
    }
    out += s.slice(i, lt);
    const gt = noMoreClose ? -1 : s.indexOf(">", lt + 1);
    if (gt === -1) {
      noMoreClose = true;
      i = lt + 1; // stray "<": dropped
      continue;
    }
    const m = /^(script|style)(?![a-z0-9])/.exec(lower.slice(lt + 1, lt + 8));
    if (m === null) {
      out += " ";
      i = gt + 1;
      continue;
    }
    const end = lower.indexOf(`</${m[1]}`, gt + 1);
    if (end === -1) {
      out += " ";
      break; // unclosed script/style: the rest is code
    }
    const endGt = s.indexOf(">", end);
    out += " ";
    if (endGt === -1) break;
    i = endGt + 1;
  }
  return out;
}

/** Cuts to at most `max` code points (never inside a surrogate pair); an ellipsis marks the cut. */
function capChars(s: string, max: number): string {
  const chars = Array.from(s);
  return chars.length <= max ? s : chars.slice(0, max - 1).join("") + "…";
}

/** Plain single-line text: no control/bidi/zero-width characters, no markup, collapsed whitespace, capped. */
export function sanitizeText(input: string, max: number = MAX_NAME): string {
  let bounded = input.length > MAX_INPUT ? input.slice(0, MAX_INPUT) : input;
  const last = bounded.charCodeAt(bounded.length - 1);
  if (last >= 0xd800 && last <= 0xdbff) bounded = bounded.slice(0, -1); // do not cut a surrogate pair
  const s = stripMarkup(
    bounded
      .replace(LONE_SURROGATE, "\ufffd")
      .replace(/[\t\n\v\f\r]/g, " ") // line breaks and tabs separate words
      .replace(INVISIBLE, ""), // before \s: JS counts U+FEFF as whitespace
  )
    .replace(/[<>]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return capChars(s, max);
}

/** Whole-message cap (UTF-16 length, as the notify channel counts); keeps surrogate pairs intact. */
export function capMessage(text: string, max: number = MAX_MESSAGE): string {
  if (text.length <= max) return text;
  let cut = max - 1;
  const last = text.charCodeAt(cut - 1);
  if (last >= 0xd800 && last <= 0xdbff) cut--; // do not leave a lone high surrogate
  return text.slice(0, cut) + "…";
}

/**
 * Own-domain rule: the link is http(s), has no credentials, and its host equals the host of one of the watch URLs
 * or is a subdomain of it, where a leading "www." of the watch host is ignored. So www.rosebikes.com allows
 * rosebikes.com and de.rosebikes.com, but not rosebikes.com.evil.net, and shop.example.com does not allow example.com.
 */
export function isOwnDomainUrl(link: string, watchUrls: string[]): boolean {
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u0020\u007f-\u009f]/.test(link)) return false;
  let u: URL;
  try {
    u = new URL(link);
  } catch {
    return false;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return false;
  if (u.username !== "" || u.password !== "") return false;
  return watchUrls.some((w) => {
    let base: string;
    try {
      base = new URL(w).hostname.replace(/^www\./, "");
    } catch {
      return false;
    }
    return base !== "" && (u.hostname === base || u.hostname.endsWith(`.${base}`));
  });
}

/** The link if it is on the watch's own domain (and not absurdly long), otherwise the first watch URL. */
export function safeUrl(link: string, watchUrls: string[]): string {
  return link.length <= MAX_URL && isOwnDomainUrl(link, watchUrls) ? link : (watchUrls[0] ?? "");
}
