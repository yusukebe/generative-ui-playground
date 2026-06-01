import { z } from 'zod'

export const CardSchema = z.object({
  title: z.string(),
  subtitle: z.string().optional(),
  body: z.string().optional(),
  tags: z.array(z.string()).optional(),
  variant: z.enum(['default', 'highlight']).optional(),
})

export const SectionSchema = z.object({
  heading: z.string().optional(),
  description: z.string().optional(),
  cards: z.array(CardSchema),
})

export const DeclarativeUISchema = z.object({
  title: z.string().optional(),
  intro: z.string().optional(),
  sections: z.array(SectionSchema),
})

export type DeclarativeUI = z.infer<typeof DeclarativeUISchema>
export type CardNode = z.infer<typeof CardSchema>
export type SectionNode = z.infer<typeof SectionSchema>
