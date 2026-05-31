export type ModelId =
  | '@cf/meta/llama-4-scout-17b-16e-instruct'
  | '@cf/meta/llama-3.3-70b-instruct-fp8-fast'
  | '@cf/meta/llama-3.1-8b-instruct'
  | '@cf/google/gemma-3-12b-it'
  | '@cf/qwen/qwen2.5-coder-32b-instruct'

export type ModelInfo = {
  id: ModelId
  label: string
  vendor: string
  description: string
}

export const MODELS: ModelInfo[] = [
  {
    id: '@cf/meta/llama-4-scout-17b-16e-instruct',
    label: 'Llama 4 Scout',
    vendor: 'Meta',
    description: '17B MoE · 万能型',
  },
  {
    id: '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
    label: 'Llama 3.3 70B',
    vendor: 'Meta',
    description: '70B fp8 · 高品質',
  },
  {
    id: '@cf/meta/llama-3.1-8b-instruct',
    label: 'Llama 3.1 8B',
    vendor: 'Meta',
    description: '8B · 軽量・高速',
  },
  {
    id: '@cf/google/gemma-3-12b-it',
    label: 'Gemma 3 12B',
    vendor: 'Google',
    description: '12B · 多言語',
  },
  {
    id: '@cf/qwen/qwen2.5-coder-32b-instruct',
    label: 'Qwen 2.5 Coder',
    vendor: 'Alibaba',
    description: '32B · コード寄り',
  },
]

export const DEFAULT_MODEL: ModelId = MODELS[0].id

export function findModel(id: string): ModelInfo | undefined {
  return MODELS.find((m) => m.id === id)
}
