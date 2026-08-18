// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useEmergencySessionRows } from '../src/client/emergency-session-rows.ts'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('emergency session row metadata', () => {
  it('batches event metadata and participant requests once per browser mount', async () => {
    const request = vi.fn(async (input: string | URL | Request) => {
      const url = String(input)
      if (url.endsWith('/api/emergency-session/sessions')) {
        return new Response(JSON.stringify({ sessions: [
          { sessionId: 'team-a', kind: 'emergency-team' },
          { sessionId: 'team-b', kind: 'emergency-team' },
          { sessionId: 'event-a', kind: 'emergency-event' },
        ] }))
      }
      return new Response(JSON.stringify({ participants: [
        { displayName: 'Member', roleName: 'Role', status: 'online' },
      ] }))
    })
    vi.stubGlobal('fetch', request)

    const view = renderHook(() => useEmergencySessionRows())
    await waitFor(() => { expect(view.result.current.ready).toBe(true) })
    expect(request).toHaveBeenCalledTimes(4)
    expect(view.result.current.bySession.get('team-a')?.kind).toBe('team')
    const teamB = view.result.current.bySession.get('team-b')
    if (teamB?.kind !== 'team') throw new Error('team-b metadata missing')
    expect(teamB.participants).toHaveLength(1)
    const eventA = view.result.current.bySession.get('event-a')
    if (eventA?.kind !== 'event') throw new Error('event-a metadata missing')
    expect(eventA.participants).toHaveLength(1)

    view.rerender()
    expect(request).toHaveBeenCalledTimes(4)
  })
})
