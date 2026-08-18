// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import {
  ReferenceChip, ReferenceText, formatStructuredReference, parseStructuredReferences,
  projectStructuredReferenceText,
} from '@deepseek-ai/dsh-client-ui-primitives'

afterEach(cleanup)

describe('structured references', () => {
  it('formats a named location with six-decimal coordinates and time without its internal id', () => {
    const token = '[[EH_REF_V1:{"kind":"location","id":"geo-object-internal-42","name":"东门","location":{"longitude":121.1,"latitude":31.2},"time":"2026-08-14T06:05:00.000Z"}]]'

    const segments = parseStructuredReferences(`前往 ${token} 集合`)

    expect(segments).toHaveLength(3)
    const reference = segments[1]
    if (reference?.kind !== 'reference') throw new Error('reference segment missing')
    expect(formatStructuredReference(reference.reference)).toBe('📍 东门 (121.100000, 31.200000) · 14:05:00')
    expect(formatStructuredReference(reference.reference)).not.toContain('geo-object-internal-42')
    expect(projectStructuredReferenceText(token)).toBe('📍 东门 (121.100000, 31.200000) · 14:05:00')
  })

  it('formats location shapes with type icons and point-only coordinates', () => {
    expect(formatStructuredReference({ kind: 'location', shape: 'point', name: '东门集结点', location: { longitude: 118.806, latitude: 32.05 } }))
      .toBe('📍 东门集结点 (118.806000, 32.050000)')
    expect(formatStructuredReference({ kind: 'location', shape: 'point', location: { longitude: 118.806, latitude: 32.05 } }))
      .toBe('📍 (118.806000, 32.050000)')
    // Routes and areas identify by name and never spell out coordinate lists.
    expect(formatStructuredReference({ kind: 'location', shape: 'route', name: '东侧进场路线', location: { longitude: 118.806, latitude: 32.05 } }))
      .toBe('〰 东侧进场路线')
    expect(formatStructuredReference({ kind: 'location', shape: 'area', name: '热区（核心区）' }))
      .toBe('⬡ 热区（核心区）')
    expect(formatStructuredReference({ kind: 'location', shape: 'route' })).toBe('路径')
    expect(formatStructuredReference({ kind: 'location', shape: 'area' })).toBe('区域')
    // The shape survives the wire round-trip.
    const segments = parseStructuredReferences('[[EH_REF_V1:{"kind":"location","shape":"route","name":"东侧进场路线"}]]')
    const segment = segments[0]
    if (segment?.kind !== 'reference') throw new Error('reference segment missing')
    expect(segment.reference.shape).toBe('route')
  })

  it('parses legacy locations and keeps malformed tokens as literal text', () => {
    const legacy = '[[EH_LOCATION_V1:{"location":{"longitude":120.1234567,"latitude":30.7654321},"time":null}]]'
    const malformed = '[[EH_REF_V1:{not-json}]]'

    expect(projectStructuredReferenceText(legacy)).toBe('📍 (120.123457, 30.765432)')
    expect(parseStructuredReferences(malformed)).toEqual([{ kind: 'text', text: malformed }])
  })

  it('shows the object type and user-facing name for non-location references', () => {
    expect(formatStructuredReference({ kind: 'asset', id: 'asset-row-991', name: 'V-17 转运歧管' })).toBe('▣ 资产 · V-17 转运歧管')
    expect(formatStructuredReference({ kind: 'issue', id: 'issue-row-204' })).toBe('! 问题')
    expect(formatStructuredReference({ kind: 'fact', id: 'fact-row-773', name: '氯气浓度 120 ppm' })).toBe('◆ 事实 · 氯气浓度 120 ppm')
  })

  it('renders the same reference chip from direct and segmented projections', () => {
    const reference = { kind: 'asset', id: 'asset-row-991', name: 'V-17 转运歧管' } as const
    const direct = render(<ReferenceChip reference={reference} />)
    expect(direct.container.querySelector('[data-reference-chip="asset"]')?.textContent).toBe('▣ 资产 · V-17 转运歧管')
    direct.unmount()

    const segmented = render(<ReferenceText text={'资产 [[EH_REF_V1:{"kind":"asset","id":"asset-row-991","name":"V-17 转运歧管"}]]'} />)
    expect(segmented.container.querySelector('[data-reference-chip="asset"]')?.textContent).toBe('▣ 资产 · V-17 转运歧管')
    expect(segmented.container.textContent).not.toContain('EH_REF_V1')
    expect(segmented.container.textContent).not.toContain('asset-row-991')
  })
})
