import { createOpenAI } from '@ai-sdk/openai'
import type { LanguageModel } from 'ai'
import { createWorkersAI } from 'workers-ai-provider'
import { findModel, type ModelId } from './models'

/**
 * model id から実際の LanguageModel を解決する (agent / compare で共用)。
 * - provider 'openai' かつ OPENAI_API_KEY あり → @ai-sdk/openai (AI Gateway があれば経由)
 * - それ以外 (キー無し含む) → Workers AI (Cloudflare 完結のフォールバック)
 */
export function resolveModel(
  env: CloudflareBindings,
  id: ModelId
): { model: LanguageModel; isOpenAI: boolean } {
  const gateway = env.CF_AI_GATEWAY
  const accountId = env.CF_ACCOUNT_ID ?? '6fb40523bf88433d6ae98c9e456d815d'
  const info = findModel(id)

  if (info?.provider === 'openai' && env.OPENAI_API_KEY) {
    const baseURL = gateway
      ? `https://gateway.ai.cloudflare.com/v1/${accountId}/${gateway}/openai`
      : undefined
    const openai = createOpenAI({ apiKey: env.OPENAI_API_KEY, baseURL })
    return { model: openai(id.replace(/^openai:/, '')), isOpenAI: true }
  }

  const workersai = createWorkersAI({ binding: env.AI })
  const fallbackId = info?.provider === 'openai' ? '@cf/openai/gpt-oss-120b' : id
  const model = gateway ? workersai(fallbackId, { gateway: { id: gateway } }) : workersai(fallbackId)
  return { model, isOpenAI: false }
}
