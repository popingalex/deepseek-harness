/**
 * Draft decoration pure core (references render from occurrence ranges; the
 * claim token renders as a mirror-layer
 * highlight, the claim hint as ghost text). Zero React — the skeleton renders
 * the instructions; tests drive this directly.
 */
import type { TriggerChar } from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import type { InputState } from './contract.ts'

/** The claim-token highlight range (always draft-leading while the watch holds). */
export interface TokenRange {
  readonly start: number
  readonly end: number
}

/** One structured inline-reference render instruction. */
export interface ChipRender {
  /** Stable render key (same-labeled chips stay independent). */
  readonly occurrenceId: number
  /** Placeholder offset in the draft (the chip occupies [offset, offset+1)). */
  readonly offset: number
  readonly label: string
  /** Owning source name for integration-level projection selectors. */
  readonly source: string
  /** Optional domain glyph beside the label. */
  readonly appearance?: 'session' | 'file' | 'folder'
  /** Owner-resolution failure styling bit. */
  readonly invalid: boolean
}

/**
 * One plain-text reference range (the plain-text-reference decision;
 * see .agents/notes/implemented/architecture/2026-07-25-web-input-machine-and-slash-pipeline.md):
 * a `/name` or `@name` token
 * whose name is on the trigger's lexicon. Pure derivation — editing the text
 * out of match shape simply drops the range next scan.
 */
export interface TextRefRange {
  readonly start: number
  readonly end: number
  readonly trigger: TriggerChar
  /** Optional icon domain for syntax-recognizable plain references. */
  readonly appearance?: 'folder'
}

/** Decoration product: claim token range + chip instructions + text-ref ranges + the ghost hint. */
export interface DraftDecorations {
  /** Claim token range while claimed/submitting and the prefix watch holds; null otherwise. */
  readonly token: TokenRange | null
  /** Chip render instructions in draft order (occurrence table is offset-sorted). */
  readonly chips: readonly ChipRender[]
  /** Scan-derived lexicon tokens and syntax-recognizable folder ranges. */
  readonly textRefs: readonly TextRefRange[]
  /** Ghost hint shown while the claim's args are blank; null otherwise. */
  readonly hint: string | null
}

/** Token matcher: a trigger char at line start or after whitespace, then a word-ish name (never crosses \n). */
const TEXT_REF_RE = /(^|\s)([/@])([\w-]+)/g
const FOLDER_REF_RE = /(^|\s)(@(?:"[^"\n]*\/|[^\s"]+\/))/g

/**
 * Scan the draft for plain-text reference tokens against the hot lexicons.
 * Word-boundary discipline: the trigger must sit at the draft
 * start or after whitespace ('x/name' never matches); the name must be an
 * exact lexicon member.
 * @param draft - draft text.
 * @param lexicon - per-trigger name lists (a missing trigger scans nothing).
 * @returns matched ranges in draft order.
 */
export function scanTextRefs(
  draft: string, lexicon: ReadonlyMap<TriggerChar, readonly string[]>,
): TextRefRange[] {
  if (draft === '') return []
  const out: TextRefRange[] = []
  if (lexicon.size > 0) {
    TEXT_REF_RE.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = TEXT_REF_RE.exec(draft)) !== null) {
      const trigger = m[2] as TriggerChar
      const name = m[3] ?? ''
      if (lexicon.get(trigger)?.includes(name)) {
        const start = m.index + (m[1]?.length ?? 0)
        out.push({ start, end: start + 1 + name.length, trigger })
      }
    }
  }
  FOLDER_REF_RE.lastIndex = 0
  let folder: RegExpExecArray | null
  while ((folder = FOLDER_REF_RE.exec(draft)) !== null) {
    const token = folder[2] ?? ''
    const start = folder.index + (folder[1]?.length ?? 0)
    const end = start + token.length
    if (!out.some(range => range.start < end && range.end > start)) {
      out.push({ start, end, trigger: '@', appearance: 'folder' })
    }
  }
  return out.sort((left, right) => left.start - right.start)
}

/** The empty lexicon (default: zero text-ref decorations, old call sites unchanged). */
const EMPTY_LEXICON: ReadonlyMap<TriggerChar, readonly string[]> = new Map()

/**
 * Derive the mirror-layer decorations from the input state.
 * @param state - published input state.
 * @param lexicon - optional per-trigger reference lexicons (plain-text-reference scan).
 * @returns token range, chip instructions, text-ref ranges, and the ghost hint.
 */
export function deriveDecorations(
  state: InputState, lexicon: ReadonlyMap<TriggerChar, readonly string[]> = EMPTY_LEXICON,
): DraftDecorations {
  const { draft, claim, phase, occurrences } = state
  const claimActive = (phase === 'claimed' || phase === 'submitting')
    && claim !== undefined && draft.startsWith(claim.token)
  const token: TokenRange | null = claimActive ? { start: 0, end: claim.token.length } : null
  const chips = occurrences.map(o => ({
    occurrenceId: o.occurrenceId,
    offset: o.offset,
    label: o.label,
    source: o.source,
    ...o.appearance === undefined ? {} : { appearance: o.appearance },
    invalid: o.invalid === true,
  }))
  const hint = claimActive && claim.hint !== undefined && draft.slice(claim.token.length).trim() === ''
    ? claim.hint
    : null
  return { token, chips, textRefs: scanTextRefs(draft, lexicon), hint }
}
