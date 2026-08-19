// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { useEmergencySessionRows } from '../src/client/emergency-session-rows.ts'

afterEach(() => {
  cleanup()
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

  it('drops malformed session and participant entries from the row map', async () => {
    const request = vi.fn(async (input: string | URL | Request) => {
      const url = String(input)
      if (url.endsWith('/api/emergency-session/sessions')) {
        return new Response(JSON.stringify({ sessions: [
          'junk',
          { sessionId: 'other-x', kind: 'other' },
          { sessionId: 42, kind: 'emergency-team' },
          { sessionId: 'team-a', kind: 'emergency-team' },
        ] }))
      }
      return new Response(JSON.stringify({ participants: [
        'junk',
        { roleName: 'Role', status: 'online' },
        { displayName: 'Member', status: 'online' },
        { displayName: 'Member', roleName: 'Role' },
        { displayName: 'Member', roleName: 'Role', status: 'online' },
      ] }))
    })
    vi.stubGlobal('fetch', request)

    const view = renderHook(() => useEmergencySessionRows())
    await waitFor(() => { expect(view.result.current.ready).toBe(true) })
    const teamA = view.result.current.bySession.get('team-a')
    if (teamA?.kind !== 'team') throw new Error('team-a metadata missing')
    expect(teamA.participants).toHaveLength(1)
    expect(view.result.current.bySession.size).toBe(1)
  })

  it('treats non-record payloads as empty lists', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      if (String(input).endsWith('/api/emergency-session/sessions')) {
        return new Response(JSON.stringify({ sessions: [{ sessionId: 'team-a', kind: 'emergency-team' }] }))
      }
      return new Response('null')
    }))

    const view = renderHook(() => useEmergencySessionRows())
    await waitFor(() => { expect(view.result.current.ready).toBe(true) })
    const teamA = view.result.current.bySession.get('team-a')
    if (teamA?.kind !== 'team') throw new Error('team-a metadata missing')
    expect(teamA.participants).toEqual([])

    vi.stubGlobal('fetch', vi.fn(async () => new Response('null')))
    const empty = renderHook(() => useEmergencySessionRows())
    await waitFor(() => { expect(empty.result.current.ready).toBe(true) })
    expect(empty.result.current.bySession.size).toBe(0)
  })

  it('warns and stays empty when the metadata request fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 500 })))
      const view = renderHook(() => useEmergencySessionRows())
      await waitFor(() => { expect(view.result.current.ready).toBe(true) })
      expect(view.result.current.bySession.size).toBe(0)
      expect(warn).toHaveBeenCalledOnce()
    } finally {
      warn.mockRestore()
    }
  })

  it('reloads when the metadata-changed event fires', async () => {
    const request = vi.fn(async () => new Response(JSON.stringify({ sessions: [] })))
    vi.stubGlobal('fetch', request)
    const view = renderHook(() => useEmergencySessionRows())
    await waitFor(() => { expect(view.result.current.ready).toBe(true) })
    expect(request).toHaveBeenCalledTimes(1)

    await act(async () => { globalThis.dispatchEvent(new Event('eh:session-metadata-changed')) })
    expect(request).toHaveBeenCalledTimes(2)
  })

  it('drops a late resolution once unmounted', async () => {
    let resolveSessions!: (response: Response) => void
    vi.stubGlobal('fetch', vi.fn((input: string | URL | Request) => {
      if (String(input).endsWith('/api/emergency-session/sessions')) {
        return new Promise<Response>((resolve) => { resolveSessions = resolve })
      }
      return Promise.resolve(new Response(JSON.stringify({ participants: [] })))
    }))
    const view = renderHook(() => useEmergencySessionRows())
    view.unmount()
    resolveSessions(new Response(JSON.stringify({ sessions: [] })))
    await act(async () => {})
    expect(view.result.current.ready).toBe(false)
  })

  it('swallows a late rejection once unmounted', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      let rejectSessions!: (reason: Error) => void
      vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((_resolve, reject) => { rejectSessions = reject })))
      const view = renderHook(() => useEmergencySessionRows())
      view.unmount()
      rejectSessions(new Error('late failure'))
      await act(async () => {})
      expect(warn).not.toHaveBeenCalled()
    } finally {
      warn.mockRestore()
    }
  })
})
