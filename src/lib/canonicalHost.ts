/**
 * Firebase's redirect sign-in hands the credential back through
 * `https://{authDomain}/__/auth/handler`. If the app is served from a
 * different origin than that handler, Chrome's third-party storage
 * partitioning drops the result: Google accepts the sign-in and the app
 * still comes back signed out, with no error anywhere. Confirmed the hard
 * way on 2026-09-06.
 *
 * Firebase gives every project two Hosting domains for the same site -
 * `<project>.web.app` and `<project>.firebaseapp.com` - and only the
 * second one is the authDomain and the registered OAuth redirect URI.
 * So the `.web.app` twin is a working-looking URL on which sign-in is
 * silently broken, and it is exactly the kind of link that gets pasted
 * into a WhatsApp group by accident.
 *
 * Rather than relying on everyone remembering which of two near-identical
 * URLs is the real one, send the wrong one to the right one.
 */
export function canonicalUrlFor(href: string, authDomain: string): string | null {
  const url = new URL(href)

  // localhost and the canonical host itself are both fine; only the
  // `.web.app` twin is the trap.
  if (!url.hostname.endsWith('.web.app')) return null
  if (url.hostname === authDomain) return null

  url.hostname = authDomain
  return url.toString()
}
