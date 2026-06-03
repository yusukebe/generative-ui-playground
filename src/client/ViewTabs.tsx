export type View = 'chat' | 'compare'

const TABS: { value: View; label: string }[] = [
  { value: 'chat', label: 'チャット' },
  { value: 'compare', label: '4パターン比較 ✨' },
]

export function ViewTabs({ value, onChange }: { value: View; onChange: (v: View) => void }) {
  return (
    <div className='view-tabs' role='tablist'>
      {TABS.map((t) => (
        <button
          key={t.value}
          type='button'
          role='tab'
          className='view-tabs__tab'
          data-active={t.value === value}
          onClick={() => onChange(t.value)}
        >
          {t.label}
        </button>
      ))}
    </div>
  )
}
