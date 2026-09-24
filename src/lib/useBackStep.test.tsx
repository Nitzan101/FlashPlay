import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { beforeEach, describe, expect, it } from 'vitest'
import { useBackStep } from './useBackStep'

/** A group screen with one person page inside it, like GroupDetails. */
function Nested() {
  const [group, setGroup] = useState(false)
  const [person, setPerson] = useState(false)
  useBackStep(group, () => setGroup(false))
  useBackStep(person, () => setPerson(false))
  return (
    <div>
      {!group && <button onClick={() => setGroup(true)}>open group</button>}
      {group && !person && <button onClick={() => setPerson(true)}>open person</button>}
      {group && <p>group page</p>}
      {person && <button onClick={() => setPerson(false)}>close person</button>}
      {person && <p>person page</p>}
      {group && !person && <button onClick={() => setGroup(false)}>close group</button>}
    </div>
  )
}

const back = () => act(() => window.history.back())

// The previous test's unmount pops its entries asynchronously; let those land
// before this one starts, or they arrive mid-test.
beforeEach(async () => {
  await new Promise((resolve) => setTimeout(resolve, 30))
  window.history.replaceState(null, '')
})

describe('useBackStep', () => {
  it('closes only the innermost screen on Back, one screen per press', async () => {
    render(<Nested />)
    fireEvent.click(screen.getByText('open group'))
    fireEvent.click(screen.getByText('open person'))
    expect(screen.getByText('person page')).toBeInTheDocument()

    back()
    await waitFor(() => expect(screen.queryByText('person page')).not.toBeInTheDocument())
    expect(screen.getByText('group page')).toBeInTheDocument()

    back()
    await waitFor(() => expect(screen.queryByText('group page')).not.toBeInTheDocument())
    expect(screen.getByText('open group')).toBeInTheDocument()
  })

  // The pop a screen's own button produces must not close the screen beneath.
  it('closing a screen from its own button does not close the one beneath', async () => {
    render(<Nested />)
    fireEvent.click(screen.getByText('open group'))
    fireEvent.click(screen.getByText('open person'))

    fireEvent.click(screen.getByText('close person'))
    await new Promise((resolve) => setTimeout(resolve, 50))

    expect(screen.getByText('group page')).toBeInTheDocument()
    expect(screen.queryByText('person page')).not.toBeInTheDocument()
  })

  it('leaves no entry behind after a screen is closed from its own button', async () => {
    window.history.replaceState({ base: true }, '')
    render(<Nested />)
    fireEvent.click(screen.getByText('open group'))
    expect(window.history.state).toEqual({ flashplayStep: 1 })

    fireEvent.click(screen.getByText('close group'))
    await waitFor(() => expect(window.history.state).toEqual({ base: true }))
  })

  it('does nothing on Back when no screen is open', () => {
    render(<Nested />)
    back()
    expect(screen.getByText('open group')).toBeInTheDocument()
  })
})
