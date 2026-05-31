import type { CardNode, DeclarativeUI, SectionNode } from '../../schemas/declarative'

export function DeclarativeView({ ui }: { ui: DeclarativeUI }) {
  return (
    <div className='declarative'>
      {ui.title && <h2 className='declarative__title'>{ui.title}</h2>}
      {ui.intro && <p className='declarative__intro'>{ui.intro}</p>}
      {ui.sections.map((s, i) => (
        <SectionView key={i} section={s} />
      ))}
    </div>
  )
}

function SectionView({ section }: { section: SectionNode }) {
  return (
    <section className='decl-section'>
      {section.heading && <h3 className='decl-section__heading'>{section.heading}</h3>}
      {section.description && <p className='decl-section__desc'>{section.description}</p>}
      <div className='decl-section__cards'>
        {section.cards.map((c, i) => (
          <CardView key={i} card={c} />
        ))}
      </div>
    </section>
  )
}

function CardView({ card }: { card: CardNode }) {
  return (
    <article className='decl-card' data-variant={card.variant ?? 'default'}>
      <div className='decl-card__title'>{card.title}</div>
      {card.subtitle && <div className='decl-card__subtitle'>{card.subtitle}</div>}
      {card.body && <div className='decl-card__body'>{card.body}</div>}
      {card.tags && card.tags.length > 0 && (
        <div className='decl-card__tags'>
          {card.tags.map((t) => (
            <span key={t} className='decl-card__tag'>
              {t}
            </span>
          ))}
        </div>
      )}
    </article>
  )
}
