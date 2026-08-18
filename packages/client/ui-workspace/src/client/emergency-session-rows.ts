import { useEffect, useState } from 'react'

export interface EmergencyParticipantRow {
  readonly displayName: string
  readonly roleName: string
  readonly status: string
}

export type EmergencySessionRowMetadata =
  | { readonly kind: 'standard' }
  | { readonly kind: 'team'; readonly participants: readonly EmergencyParticipantRow[] }
  | { readonly kind: 'event'; readonly participants: readonly EmergencyParticipantRow[] }

export interface EmergencySessionRowsState {
  readonly ready: boolean
  readonly bySession: ReadonlyMap<string, EmergencySessionRowMetadata>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function emergencySessionKinds(value: unknown): ReadonlyMap<string, 'team' | 'event'> {
  if (!isRecord(value) || !Array.isArray(value.sessions)) return new Map()
  return new Map(value.sessions.flatMap((session) => {
    if (!isRecord(session)
      || (session.kind !== 'emergency-team' && session.kind !== 'emergency-event')
      || typeof session.sessionId !== 'string') return []
    return [[session.sessionId, session.kind === 'emergency-event' ? 'event' : 'team'] as const]
  }))
}

function participantRows(value: unknown): readonly EmergencyParticipantRow[] {
  if (!isRecord(value) || !Array.isArray(value.participants)) return []
  return value.participants.flatMap((participant) => {
    if (!isRecord(participant)
      || typeof participant.displayName !== 'string'
      || typeof participant.roleName !== 'string'
      || typeof participant.status !== 'string') return []
    return [{
      displayName: participant.displayName,
      roleName: participant.roleName,
      status: participant.status,
    }]
  })
}

async function responseJson(response: Response): Promise<unknown> {
  if (!response.ok) throw new Error(`EH session metadata request failed: ${response.status}`)
  return response.json()
}

export function useEmergencySessionRows(): EmergencySessionRowsState {
  const [state, setState] = useState<EmergencySessionRowsState>({ ready: false, bySession: new Map() })
  useEffect(() => {
    const controller = new AbortController()
    const load = async (): Promise<void> => {
      const sessions = await responseJson(await fetch('/api/emergency-session/sessions', { signal: controller.signal }))
      const kinds = emergencySessionKinds(sessions)
      const entries = await Promise.all([...kinds.entries()].map(async ([sessionId, kind]) => {
        const participants = await responseJson(await fetch(
          `/api/emergency-session/sessions/${encodeURIComponent(sessionId)}/participants`,
          { signal: controller.signal },
        ))
        return [sessionId, { kind, participants: participantRows(participants) }] as const
      }))
      if (!controller.signal.aborted) setState({ ready: true, bySession: new Map(entries) })
    }
    void load().catch((reason: unknown) => {
      if (controller.signal.aborted) return
      console.warn('emergency session row metadata unavailable:', reason)
      setState({ ready: true, bySession: new Map() })
    })
    const onChanged = () => { void load() }
    globalThis.addEventListener('eh:session-metadata-changed', onChanged)
    return () => {
      controller.abort()
      globalThis.removeEventListener('eh:session-metadata-changed', onChanged)
    }
  }, [])
  return state
}
