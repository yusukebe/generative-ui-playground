/**
 * 天気ツール (Open-Meteo · API キー不要)。
 * 指定日の横浜(関内付近)の日次予報を取得する。最大 16 日先まで対応。
 * 「プラン作成」タスクで、日付 → 天気 → 店検索 → プラン と「やることが多い」ことで
 * ストリーミングの差が見えるようにするための一手。
 */
import { tool } from 'ai'
import { z } from 'zod'

// 関内(横浜)の緯度経度
const LAT = 35.4437
const LON = 139.638

// WMO weather code → 日本語のざっくり天気
function describeWeatherCode(code: number): { label: string; emoji: string } {
  if (code === 0) return { label: '快晴', emoji: '☀️' }
  if (code <= 2) return { label: '晴れ時々曇り', emoji: '🌤️' }
  if (code === 3) return { label: '曇り', emoji: '☁️' }
  if (code <= 48) return { label: '霧', emoji: '🌫️' }
  if (code <= 57) return { label: '霧雨', emoji: '🌦️' }
  if (code <= 67) return { label: '雨', emoji: '🌧️' }
  if (code <= 77) return { label: '雪', emoji: '🌨️' }
  if (code <= 82) return { label: 'にわか雨', emoji: '🌦️' }
  if (code <= 86) return { label: 'にわか雪', emoji: '🌨️' }
  if (code <= 99) return { label: '雷雨', emoji: '⛈️' }
  return { label: '不明', emoji: '🌡️' }
}

export type Weather = {
  date: string
  label: string
  emoji: string
  tempMax: number | null
  tempMin: number | null
  precipProb: number | null
}

export async function getWeather(date: string): Promise<Weather | null> {
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${LAT}&longitude=${LON}` +
    `&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max` +
    `&timezone=Asia%2FTokyo&forecast_days=16`
  const res = await fetch(url)
  if (!res.ok) return null
  const data = (await res.json()) as {
    daily?: {
      time?: string[]
      weather_code?: number[]
      temperature_2m_max?: number[]
      temperature_2m_min?: number[]
      precipitation_probability_max?: (number | null)[]
    }
  }
  const days = data.daily?.time ?? []
  const i = days.indexOf(date)
  if (i < 0) return null
  const code = data.daily?.weather_code?.[i] ?? -1
  const { label, emoji } = describeWeatherCode(code)
  return {
    date,
    label,
    emoji,
    tempMax: data.daily?.temperature_2m_max?.[i] ?? null,
    tempMin: data.daily?.temperature_2m_min?.[i] ?? null,
    precipProb: data.daily?.precipitation_probability_max?.[i] ?? null,
  }
}

export const WeatherInputSchema = z.object({
  date: z
    .string()
    .describe('YYYY-MM-DD 形式の対象日。ユーザの「来週の月曜日」等を今日の日付から解決して渡す'),
})

export const weatherTool = tool({
  description:
    '指定日の横浜(関内)の天気を取得する。プランを組む前に呼び、雨なら屋内寄りにするなど提案に反映する。',
  inputSchema: WeatherInputSchema,
  execute: async ({ date }) => {
    const weather = await getWeather(date)
    return weather ?? { date, label: '取得できず', emoji: '🌡️', tempMax: null, tempMin: null, precipProb: null }
  },
})
