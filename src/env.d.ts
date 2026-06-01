// .dev.vars / wrangler secret で渡す値のうち、cf-typegen が拾わないものを補う。
// (OPENAI_API_KEY / GOOGLE_MAPS_API_KEY は .dev.vars にあれば cf-typegen が
//  worker-configuration.d.ts に生成する。ここでは Gateway 系だけ宣言する)
// Agents SDK の Env 制約に合わせ、値は string (実行時に未設定なら undefined だが
// コード側で truthy チェックして使う)。
declare global {
  interface CloudflareBindings {
    /** AI Gateway 名。設定すると OpenAI / Workers AI 呼び出しを Gateway 経由にする */
    CF_AI_GATEWAY: string
    /** Cloudflare アカウント ID (OpenAI を Gateway 経由にする baseURL 用) */
    CF_ACCOUNT_ID: string
  }
}

export {}
