import type { DeclarativeUI } from '../../schemas/declarative'

// streamObject の途中状態 (DeepPartial) でも描画できるよう、全フィールドを optional 扱いにする
type PartialCard = {
  title?: string | null
  subtitle?: string | null
  body?: string | null
  tags?: (string | null | undefined)[] | null
  variant?: 'default' | 'highlight' | null
}
type PartialSection = {
  heading?: string | null
  description?: string | null
  cards?: (PartialCard | null | undefined)[] | null
}
type PartialUI = {
  title?: string | null
  intro?: string | null
  sections?: (PartialSection | null | undefined)[] | null
}

export function DeclarativeView({ ui }: { ui: DeclarativeUI | PartialUI }) {
  const u = ui as PartialUI
  return (
    <div className='declarative'>
      {u.title && <h2 className='declarative__title'>{u.title}</h2>}
      {u.intro && <p className='declarative__intro'>{u.intro}</p>}
      {(u.sections ?? []).filter(Boolean).map((s, i) => (
        <SectionView key={i} section={s as PartialSection} />
      ))}
    </div>
  )
}

function SectionView({ section }: { section: PartialSection }) {
  return (
    <section className='decl-section'>
      {section.heading && <h3 className='decl-section__heading'>{section.heading}</h3>}
      {section.description && <p className='decl-section__desc'>{section.description}</p>}
      <div className='decl-section__cards'>
        {(section.cards ?? []).filter(Boolean).map((c, i) => (
          <CardView key={i} card={c as PartialCard} />
        ))}
      </div>
    </section>
  )
}

function CardView({ card }: { card: PartialCard }) {
  return (
    <article className='decl-card' data-variant={card.variant ?? 'default'}>
      <div className='decl-card__title'>{card.title}</div>
      {card.subtitle && <div className='decl-card__subtitle'>{card.subtitle}</div>}
      {card.body && <div className='decl-card__body'>{card.body}</div>}
      {card.tags && card.tags.filter(Boolean).length > 0 && (
        <div className='decl-card__tags'>
          {card.tags.filter(Boolean).map((t, i) => (
            <span key={i} className='decl-card__tag'>
              {t}
            </span>
          ))}
        </div>
      )}
    </article>
  )
}
