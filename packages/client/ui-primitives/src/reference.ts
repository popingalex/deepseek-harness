export type StructuredReferenceKind = 'location' | 'asset' | 'issue' | 'fact'

export interface StructuredReferenceLocation {
  readonly longitude: number
  readonly latitude: number
}

export interface StructuredReference {
  readonly kind: StructuredReferenceKind
  readonly id?: string
  readonly name?: string
  readonly location?: StructuredReferenceLocation
  readonly time?: string
  /** Spatial shape of a location reference: point (定位点), route (路径), area (区域). */
  readonly shape?: string
}

export type StructuredReferenceSegment =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'reference'; readonly reference: StructuredReference }

const TOKEN_PATTERN = /\[\[(EH_REF_V1|EH_LOCATION_V1):([\s\S]*?)\]\]/g
const KINDS: readonly StructuredReferenceKind[] = ['location', 'asset', 'issue', 'fact']
const FALLBACK_LABELS: Readonly<Record<StructuredReferenceKind, string>> = {
  location: '📍',
  asset: '资产引用',
  issue: '问题引用',
  fact: '事实引用',
}
const KIND_META: Readonly<Record<'asset' | 'issue' | 'fact', { readonly icon: string; readonly label: string }>> = {
  asset: { icon: '▣', label: '资产' },
  issue: { icon: '!', label: '问题' },
  fact: { icon: '◆', label: '事实' },
}
const LOCATION_SHAPE_META: Readonly<Record<string, { readonly icon: string; readonly label: string }>> = {
  point: { icon: '📍', label: '定位点' },
  route: { icon: '〰', label: '路径' },
  area: { icon: '⬡', label: '区域' },
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function optionalText(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function isReferenceKind(value: unknown): value is StructuredReferenceKind {
  return typeof value === 'string' && KINDS.some(kind => kind === value)
}

function parseLocation(value: unknown): StructuredReferenceLocation | undefined {
  if (!isRecord(value)) return undefined
  const longitude = finiteNumber(value.longitude) ?? finiteNumber(value.lon)
  const latitude = finiteNumber(value.latitude) ?? finiteNumber(value.lat)
  return longitude === undefined || latitude === undefined ? undefined : { longitude, latitude }
}

function parseEnvelope(version: string, payload: string): StructuredReference | undefined {
  let value: unknown
  try {
    value = JSON.parse(payload)
  } catch (error: unknown) {
    if (error instanceof SyntaxError) return undefined
    throw error
  }
  if (!isRecord(value)) return undefined
  const kindValue = version === 'EH_LOCATION_V1' ? 'location' : value.kind
  if (!isReferenceKind(kindValue)) return undefined
  const id = optionalText(value.id)
  const name = optionalText(value.name) ?? optionalText(value.title) ?? optionalText(value.identifier)
  const location = parseLocation(value.location)
  const time = optionalText(value.time)
  const shape = optionalText(value.shape)
  return {
    kind: kindValue,
    ...(id === undefined ? {} : { id }),
    ...(name === undefined ? {} : { name }),
    ...(location === undefined ? {} : { location }),
    ...(time === undefined ? {} : { time }),
    ...(shape === undefined ? {} : { shape }),
  }
}

function formatTime(value: string): string | undefined {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return undefined
  const parts = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(date)
  const values = new Map(parts.map(part => [part.type, part.value]))
  const year = values.get('year')
  const month = values.get('month')
  const day = values.get('day')
  const hour = values.get('hour')
  const minute = values.get('minute')
  const second = values.get('second')
  if ([year, month, day, hour, minute, second].some(part => part === undefined)) return undefined
  return `${hour}:${minute}:${second}`
}

/** Parse EH reference wire forms into display-safe text and reference segments. */
export function parseStructuredReferences(text: string): readonly StructuredReferenceSegment[] {
  TOKEN_PATTERN.lastIndex = 0
  const segments: StructuredReferenceSegment[] = []
  let cursor = 0
  let match: RegExpExecArray | null
  while ((match = TOKEN_PATTERN.exec(text)) !== null) {
    const version = match[1]
    const payload = match[2]
    if (version === undefined || payload === undefined) continue
    const reference = parseEnvelope(version, payload)
    if (reference === undefined) continue
    if (match.index > cursor) segments.push({ kind: 'text', text: text.slice(cursor, match.index) })
    segments.push({ kind: 'reference', reference })
    cursor = match.index + match[0].length
  }
  if (cursor < text.length) segments.push({ kind: 'text', text: text.slice(cursor) })
  return segments.length === 0 ? [{ kind: 'text', text }] : segments
}

/** Format one reference without exposing its storage identity. */
export function formatStructuredReference(reference: StructuredReference): string {
  const time = reference.time === undefined ? undefined : formatTime(reference.time)
  if (reference.kind === 'location') {
    const shapeMeta = LOCATION_SHAPE_META[reference.shape ?? ''] ?? { icon: '📍', label: '定位点' }
    // Routes/areas identify by name; only points spell out coordinates.
    const coordinates = reference.location === undefined || (reference.shape !== undefined && reference.shape !== 'point')
      ? undefined
      : `(${reference.location.longitude.toFixed(6)}, ${reference.location.latitude.toFixed(6)})`
    const place = [reference.name, coordinates].filter(part => part !== undefined).join(' ')
    return [place ? `${shapeMeta.icon} ${place}` : shapeMeta.label, time].filter(part => part !== undefined).join(' · ')
  }
  const meta = KIND_META[reference.kind]
  if (meta === undefined) return FALLBACK_LABELS[reference.kind]
  return `${meta.icon} ${meta.label}${reference.name === undefined ? '' : ` · ${reference.name}`}`
}

/** Return clipboard text containing display-safe labels instead of valid wire tokens. */
export function projectStructuredReferenceText(text: string): string {
  return parseStructuredReferences(text).map(segment => (
    segment.kind === 'text' ? segment.text : formatStructuredReference(segment.reference)
  )).join('')
}

/** Serialize a new structured reference for the model-visible prompt. */
export function serializeStructuredReference(reference: StructuredReference): string {
  return `[[EH_REF_V1:${JSON.stringify(reference)}]]`
}
