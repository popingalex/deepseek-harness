import { Fragment, type ReactNode } from 'react'
import type { StructuredReference } from './reference.ts'
import { formatStructuredReference, parseStructuredReferences } from './reference.ts'
import css from './ReferenceChip.module.css'

export interface ReferenceChipProps {
  readonly reference: StructuredReference
  readonly onActivate?: ((reference: StructuredReference) => void) | undefined
}

/** Display one structured reference using the native conversation chip geometry. */
export function ReferenceChip({ reference, onActivate }: ReferenceChipProps): ReactNode {
  const label = formatStructuredReference(reference)
  if (onActivate !== undefined) {
    return (
      <button
        type="button"
        className={css.chip}
        data-reference-chip={reference.kind}
        title={label}
        onClick={() => { onActivate(reference) }}
      >
        {label}
      </button>
    )
  }
  return <span className={css.chip} data-reference-chip={reference.kind} title={label}>{label}</span>
}

export interface ReferenceTextProps {
  readonly text: string
  readonly renderText?: ((text: string) => ReactNode) | undefined
}

/** Project structured reference tokens inline while delegating ordinary text rendering. */
export function ReferenceText({ text, renderText }: ReferenceTextProps): ReactNode {
  return (
    <>
      {parseStructuredReferences(text).map((segment, index) => segment.kind === 'text'
        ? <Fragment key={`text-${index}`}>{renderText?.(segment.text) ?? segment.text}</Fragment>
        : <ReferenceChip key={`reference-${index}`} reference={segment.reference} />)}
    </>
  )
}
