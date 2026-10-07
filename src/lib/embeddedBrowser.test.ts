import { describe, expect, it } from 'vitest'
import { isEmbeddedWebView } from './embeddedBrowser'

const ANDROID_CHROME =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36'
const ANDROID_WEBVIEW =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/126.0.0.0 Mobile Safari/537.36'
const IOS_SAFARI =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'
const IOS_INAPP_NO_SAFARI =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148'
const FACEBOOK_ANDROID =
  'Mozilla/5.0 (Linux; Android 13; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/450.0.0.0;]'
const INSTAGRAM =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Instagram 340.0.0'

describe('isEmbeddedWebView', () => {
  it('flags an Android WebView and the named in-app browsers', () => {
    expect(isEmbeddedWebView(ANDROID_WEBVIEW)).toBe(true)
    expect(isEmbeddedWebView(FACEBOOK_ANDROID)).toBe(true)
    expect(isEmbeddedWebView(INSTAGRAM)).toBe(true)
  })

  it('leaves real browsers alone, including iOS where redirect sign-in is confirmed to work', () => {
    expect(isEmbeddedWebView(ANDROID_CHROME)).toBe(false)
    expect(isEmbeddedWebView(IOS_SAFARI)).toBe(false)
    expect(isEmbeddedWebView(IOS_INAPP_NO_SAFARI)).toBe(false)
    expect(isEmbeddedWebView('')).toBe(false)
  })
})
