export type ModelProvider = 'workers-ai' | 'openai'

export type ModelId =
  | 'openai:gpt-4o-mini'
  | 'openai:gpt-4o'
  | '@cf/openai/gpt-oss-120b'
  | '@cf/meta/llama-3.3-70b-instruct-fp8-fast'
  | '@cf/meta/llama-4-scout-17b-16e-instruct'
  | '@cf/meta/llama-3.1-8b-instruct'
  | '@cf/google/gemma-3-12b-it'
  | '@cf/qwen/qwen2.5-coder-32b-instruct'

export type ModelInfo = {
  id: ModelId
  label: string
  vendor: string
  description: string
  provider: ModelProvider
}

export const MODELS: ModelInfo[] = [
  {
    id: 'openai:gpt-4o-mini',
    label: 'GPT-4o mini',
    vendor: 'OpenAI',
    description: '速くて安定 · tool calling / 日本語◎',
    provider: 'openai',
  },
  {
    id: 'openai:gpt-4o',
    label: 'GPT-4o',
    vendor: 'OpenAI',
    description: '高品質 · tool calling / 日本語◎',
    provider: 'openai',
  },
  {
    id: '@cf/openai/gpt-oss-120b',
    label: 'GPT-OSS 120B',
    vendor: 'OpenAI (Workers AI)',
    description: '120B · Cloudflare 完結',
    provider: 'workers-ai',
  },
  {
    id: '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
    label: 'Llama 3.3 70B',
    vendor: 'Meta (Workers AI)',
    description: '70B fp8 fast',
    provider: 'workers-ai',
  },
  {
    id: '@cf/meta/llama-4-scout-17b-16e-instruct',
    label: 'Llama 4 Scout',
    vendor: 'Meta (Workers AI)',
    description: '17B MoE · 速い',
    provider: 'workers-ai',
  },
  {
    id: '@cf/meta/llama-3.1-8b-instruct',
    label: 'Llama 3.1 8B',
    vendor: 'Meta (Workers AI)',
    description: '8B · 軽量',
    provider: 'workers-ai',
  },
  {
    id: '@cf/google/gemma-3-12b-it',
    label: 'Gemma 3 12B',
    vendor: 'Google (Workers AI)',
    description: '12B · 多言語',
    provider: 'workers-ai',
  },
  {
    id: '@cf/qwen/qwen2.5-coder-32b-instruct',
    label: 'Qwen 2.5 Coder',
    vendor: 'Alibaba (Workers AI)',
    description: '32B · コード寄り',
    provider: 'workers-ai',
  },
]

export const DEFAULT_MODEL: ModelId = MODELS[0].id

export function findModel(id: string): ModelInfo | undefined {
  return MODELS.find((m) => m.id === id)
}
