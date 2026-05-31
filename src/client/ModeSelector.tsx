export type Mode = 'controlled' | 'declarative' | 'open-ended'

const MODES: { value: Mode; label: string }[] = [
  { value: 'controlled', label: 'Controlled' },
  { value: 'declarative', label: 'Declarative' },
  { value: 'open-ended', label: 'Open-Ended' },
]

export function ModeSelector({ value, onChange }: { value: Mode; onChange: (m: Mode) => void }) {
  return (
    <div className="mode-selector" role="radiogroup" aria-label="モード切替">
      {MODES.map((m) => (
        <button
          key={m.value}
          type="button"
          role="radio"
          aria-checked={value === m.value}
          className="mode-selector__option"
          data-active={value === m.value}
          onClick={() => onChange(m.value)}
        >
          {m.label}
        </button>
      ))}
    </div>
  )
}
