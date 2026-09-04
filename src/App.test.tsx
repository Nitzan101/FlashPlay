import { render, screen } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import App from './App'
import './i18n'

describe('app shell', () => {
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
