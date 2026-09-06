import { render, screen } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import './i18n'
import { useAuthUser } from './lib/auth'

vi.mock('./lib/auth', () => ({
  signInWithGoogle: vi.fn(),
  signOutUser: vi.fn(),
  useAuthUser: vi.fn(),
}))

const mockedUseAuthUser = vi.mocked(useAuthUser)

describe('app shell', () => {
  beforeEach(() => {
    mockedUseAuthUser.mockReturnValue({ user: null, loading: false, redirectError: null })
  })

  it('renders its text through i18n rather than hardcoded strings', () => {
    render(<App />)
    // The key resolves only if i18next initialised; an unresolved key would
    // render as the literal 'tagline'.
    expect(screen.getByText('משחקים שנבנים מהאנשים שבחדר')).toBeInTheDocument()
    expect(screen.queryByText('tagline')).not.toBeInTheDocument()
  })

  it('serves an RTL Hebrew document', () => {
    // Guards the RTL decision at its only real home. A stray `npm create`
    // regenerating index.html would silently ship an LTR English document.
    const html = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8')
    expect(html).toMatch(/<html[^>]*\blang="he"/)
    expect(html).toMatch(/<html[^>]*\bdir="rtl"/)
  })
})

describe('host sign-in', () => {
  it('shows a sign-in button when no host is signed in', () => {
    mockedUseAuthUser.mockReturnValue({ user: null, loading: false, redirectError: null })
    render(<App />)
    expect(screen.getByRole('button', { name: 'התחברות עם Google' })).toBeInTheDocument()
  })

  it('shows a loading state instead of the button while auth state is unknown', () => {
    // Covers the moment right after a redirect completes: onAuthStateChanged
    // has not fired yet, so the UI must not flash a sign-in button the host
    // would otherwise be tempted to click again.
    mockedUseAuthUser.mockReturnValue({ user: null, loading: true, redirectError: null })
    render(<App />)
    expect(screen.queryByRole('button', { name: 'התחברות עם Google' })).not.toBeInTheDocument()
    expect(screen.getByText('טוען...')).toBeInTheDocument()
  })

  it('greets the signed-in host by name and offers to sign out', () => {
    mockedUseAuthUser.mockReturnValue({
      user: { displayName: 'דוד', email: 'david@example.com' } as never,
      loading: false,
      redirectError: null,
    })
    render(<App />)
    expect(screen.getByText('שלום, דוד')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'התנתקות' })).toBeInTheDocument()
  })

  it('falls back to the email when Google returns no display name', () => {
    mockedUseAuthUser.mockReturnValue({
      user: { displayName: null, email: 'david@example.com' } as never,
      loading: false,
      redirectError: null,
    })
    render(<App />)
    expect(screen.getByText('שלום, david@example.com')).toBeInTheDocument()
  })

  it('surfaces a failed redirect sign-in as an alert', () => {
    mockedUseAuthUser.mockReturnValue({
      user: null,
      loading: false,
      redirectError: new Error('auth/account-exists-with-different-credential'),
    })
    render(<App />)
    expect(screen.getByRole('alert')).toHaveTextContent('ההתחברות נכשלה. נסה שוב.')
  })
})
