import type { DeclarativeUI } from '../../schemas/declarative'
import type { Restaurant } from '../../ui-components'

// streamObject の途中状態 (DeepPartial) でも描画できるよう、全フィールドを optional 扱いにする
type PartialCard = {
  title?: string | null
  subtitle?: string | null
  body?: string | null
  tags?: (string | null | undefined)[] | null
  variant?: 'default' | 'highlight' | null
  restaurantId?: string | null
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

export function DeclarativeView({
  ui,
  restaurants = [],
}: {
  ui: DeclarativeUI | PartialUI
  restaurants?: Restaurant[]
}) {
  const u = ui as PartialUI
  const byId = new Map(restaurants.map((r) => [r.id, r]))
  return (
    <div className='declarative'>
      {u.title && <h2 className='declarative__title'>{u.title}</h2>}
      {u.intro && <p className='declarative__intro'>{u.intro}</p>}
      {(u.sections ?? []).filter(Boolean).map((s, i) => (
        <SectionView key={i} section={s as PartialSection} byId={byId} />
      ))}
    </div>
  )
}

function SectionView({
  section,
  byId,
}: {
  section: PartialSection
  byId: Map<string, Restaurant>
}) {
  return (
    <section className='decl-section'>
      {section.heading && <h3 className='decl-section__heading'>{section.heading}</h3>}
      {section.description && <p className='decl-section__desc'>{section.description}</p>}
      <div className='decl-section__cards'>
        {(section.cards ?? []).filter(Boolean).map((c, i) => (
          <CardView key={i} card={c as PartialCard} byId={byId} />
        ))}
      </div>
    </section>
  )
}

function CardView({ card, byId }: { card: PartialCard; byId: Map<string, Restaurant> }) {
  // restaurantId が候補に一致すれば、その店の写真をカード上部に出す (全バンドで写真を揃える)
  const r = card.restaurantId ? byId.get(card.restaurantId) : undefined
  return (
    <article className='decl-card' data-variant={card.variant ?? 'default'}>
      {r?.photo_url && (
        <img className='decl-card__photo' src={r.photo_url} alt={card.title ?? r.name} loading='lazy' />
      )}
      <div className='decl-card__body-wrap'>
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
      </div>
    </article>
  )
}
