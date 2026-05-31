import { MODES, type Mode } from '../modes'

export type { Mode }

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
          title={m.description}
        >
          {m.label}
        </button>
      ))}
    </div>
  )
}
