/**
 * Best-effort detection of an in-app browser that Google will refuse OAuth in
 * ("disallowed_useragent"): an Android WebView, and the in-app browsers of the
 * apps a join link tends to be opened from.
 *
 * Deliberately NOT flagged: iOS in-app browsers. Redirect sign-in was
 * confirmed working inside WhatsApp on iOS (CLAUDE.md, Open questions), and
 * an iOS WebView has no reliable user-agent marker anyway - guessing would
 * hide a button that works. Android WhatsApp is the case this exists for; it
 * is unverified on a real device, so the heuristics err towards the markers
 * the apps and Android itself document:
 *  - Android WebView puts a `wv` token inside the parenthesised platform part
 *    ("...; wv) AppleWebKit...").
 *  - Facebook / Messenger (`FBAN`, `FBAV`), Instagram, Line and WeChat name
 *    themselves in the user agent.
 *
 * A false positive costs a guest an optional button (they are told to open
 * the link in a browser); a false negative costs a failed Google page. Either
 * way the game itself is untouched.
 */
export function isEmbeddedWebView(userAgent: string): boolean {
  if (/;\s*wv\)/i.test(userAgent)) return true
  return /\b(FBAN|FBAV|FB_IAB|Instagram|Line\/|MicroMessenger|WhatsApp)\b/i.test(userAgent)
}
