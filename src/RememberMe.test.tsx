import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import './i18n'
import RememberMe from './RememberMe'
import { linkGuestWithGoogle, signInWithGoogle } from './lib/auth'

vi.mock('./lib/auth', () => ({
  linkGuestWithGoogle: vi.fn(),
  signInWithGoogle: vi.fn(),
}))

const BUTTON = 'התחברות עם Google כדי שיזכרו אותי'
const WEBVIEW_UA =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/126.0.0.0 Mobile Safari/537.36'

function setUserAgent(value: string) {
  Object.defineProperty(window.navigator, 'userAgent', { value, configurable: true })
}

afterEach(() => {
  vi.clearAllMocks()
  setUserAgent('jsdom')
})

describe('RememberMe', () => {
  it('upgrades the account in place when linking, and does a plain sign-in before joining', () => {
    const first = render(<RememberMe mode="link" />)
    fireEvent.click(screen.getByRole('button', { name: BUTTON }))
    expect(linkGuestWithGoogle).toHaveBeenCalledTimes(1)
    expect(signInWithGoogle).not.toHaveBeenCalled()
    first.unmount()

    render(<RememberMe mode="signin" />)
    fireEvent.click(screen.getByRole('button', { name: BUTTON }))
    expect(signInWithGoogle).toHaveBeenCalledTimes(1)
  })

  it('shows a note and no button in an embedded browser, where Google would refuse', () => {
    setUserAgent(WEBVIEW_UA)
    render(<RememberMe mode="link" />)

    expect(screen.getByText('פתחו את הקישור בדפדפן כדי להתחבר')).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('says it failed and stays out of the way when the sign-in cannot start', async () => {
    vi.mocked(linkGuestWithGoogle).mockRejectedValue(new Error('auth/operation-not-supported-in-this-environment'))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    render(<RememberMe mode="link" />)

    fireEvent.click(screen.getByRole('button', { name: BUTTON }))

    expect(await screen.findByRole('alert')).toHaveTextContent('אפשר להמשיך לשחק בלי זה')
    await waitFor(() => expect(screen.getByRole('button', { name: BUTTON })).toBeEnabled())
  })

  it('makes no promise about showing the guest anything the host recorded', () => {
    render(<RememberMe mode="link" />)
    expect(screen.queryByText(/התשובות שלי|מה שנשמר/)).not.toBeInTheDocument()
  })
})
