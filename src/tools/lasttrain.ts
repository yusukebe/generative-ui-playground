/**
 * 終電案内 (横浜エリア)。外部 API は使わず、主要駅の終電目安を静的に持つ。
 * 「ご飯プラン」の最後に「終電の目安／何時に出れば間に合うか」を添えるための一手。
 * (1タスクで天気・店・終電…と集約するほど、各バンドの描き分け＆ストリーミングが映える)
 */
export type LastTrain = {
  station: string
  summary: string // 終電の目安 (路線・方面・時刻)
  leaveBy: string // 逆算した「お店を出る目安」
}

type Entry = { station: string; summary: string; leaveBy: string }

// エリア → 最寄り駅・終電目安 (平日のおおよそ。デモ用の概算)
const TABLE: { match: string[]; entry: Entry }[] = [
  {
    match: ['関内', '伊勢佐木', '馬車道'],
    entry: {
      station: '関内駅',
      summary: 'JR根岸線 大船方面 0:09頃 / 横浜方面 0:24頃 · 市営地下鉄ブルーライン 0:00頃',
      leaveBy: '23:45',
    },
  },
  {
    match: ['桜木町', '野毛'],
    entry: {
      station: '桜木町駅',
      summary: 'JR根岸線 大船方面 0:07頃 / 横浜方面 0:26頃 · 市営地下鉄ブルーライン 0:02頃',
      leaveBy: '23:45',
    },
  },
  {
    match: ['みなとみらい', 'クイーンズ', 'ランドマーク'],
    entry: {
      station: 'みなとみらい駅',
      summary: 'みなとみらい線 元町・中華街方面 0:30頃 / 横浜・渋谷方面 0:10頃',
      leaveBy: '23:50',
    },
  },
  {
    match: ['中華街', '元町', '山下'],
    entry: {
      station: '元町・中華街駅',
      summary: 'みなとみらい線 横浜・渋谷方面 0:07頃 (始発駅なので座れる)',
      leaveBy: '23:45',
    },
  },
  {
    match: ['横浜駅', '横浜', 'ベイクォーター'],
    entry: {
      station: '横浜駅',
      summary: 'JR・東急・京急・相鉄・地下鉄… 各線 0:30前後まで (方面により異なる)',
      leaveBy: '0:00',
    },
  },
]

export function getLastTrain(area: string): LastTrain {
  const hit = TABLE.find((t) => t.match.some((m) => area.includes(m)))
  const e =
    hit?.entry ??
    // マッチしないエリアは横浜駅基準のざっくり案内
    { station: `${area}周辺の駅`, summary: '終電は概ね 0:00〜0:30 頃 (路線・方面による)', leaveBy: '23:45' }
  return { station: e.station, summary: e.summary, leaveBy: e.leaveBy }
}
