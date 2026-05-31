import { MODELS, type ModelId } from '../models'

export function ModelSelector({
  value,
  onChange,
}: {
  value: ModelId
  onChange: (m: ModelId) => void
}) {
  return (
    <label className='model-selector'>
      <span className='model-selector__label'>Model</span>
      <select
        className='model-selector__select'
        value={value}
        onChange={(e) => onChange(e.target.value as ModelId)}
      >
        {MODELS.map((m) => (
          <option key={m.id} value={m.id}>
            {m.label} — {m.description}
          </option>
        ))}
      </select>
    </label>
  )
}
