import { useEffect, useRef, useState } from 'react'

// code(=AIのコード) 単位で SSR 済み HTML をキャッシュ。タブを切り替えて戻っても
// 再 fetch / 再 SSR せず、描画済みのものをそのまま見せる (リロードは新しい code で来る)。
const frameHtmlCache = new Map<string, string>()

/**
 * Dynamic の Suspense SSR フレーム (本物のストリーミング)。
 * fetch で Worker の renderToReadableStream 出力を取得 (Vite dev の SPA フォールバックを回避) し、
 * チャンクを iframe へ document.write で逐次流し込む。ブラウザがネイティブに React ストリームを
 * パース → Suspense 境界が解決するたびにカードが現れる ($RC reveal)。
 * iframe は中身の高さに自動フィット (same-origin なので body.scrollHeight で測れる)。
 */
export function StreamFrame({
  code,
  restaurants,
}: {
  code: string
  restaurants: unknown[]
}) {
  const ref = useRef<HTMLIFrameElement>(null)
  // 最初のチャンクが来るまで(Worker起動の数秒)白画面になるのを防ぐローディング
  const [pending, setPending] = useState(true)
  useEffect(() => {
    const iframe = ref.current
    if (!iframe) return
    let cancelled = false
    setPending(true)
    let ro: ResizeObserver | null = null
    let lastH = 0
    const fit = () => {
      const doc = iframe.contentDocument
      const b = doc?.body
      // body.scrollHeight は viewport にクランプされず実コンテンツ高を返す
      const h = Math.max(b?.scrollHeight ?? 0, b?.offsetHeight ?? 0)
      if (h > 0 && h !== lastH) {
        // 高さだけ追従。下へオートスクロールはしない (描画時に勝手に動くのを防ぐ)
        iframe.style.height = `${h}px`
        lastH = h
      }
    }
    const timer = setInterval(fit, 200)
    const observeBody = () => {
      const doc = iframe.contentDocument
      if (doc?.body && 'ResizeObserver' in window) {
        ro = new ResizeObserver(fit)
        ro.observe(doc.body)
      }
      setTimeout(fit, 500)
      setTimeout(fit, 1500)
    }
    // 既に SSR 済み(タブ切替で戻ってきた等) ならキャッシュを書くだけ。再 fetch しない
    const cached = frameHtmlCache.get(code)
    if (cached) {
      const doc = iframe.contentDocument
      if (doc) {
        doc.open()
        doc.write(cached)
        doc.close()
        setPending(false)
        fit()
        observeBody()
      }
    } else {
      ;(async () => {
        const res = await fetch('/api/dynamic-frame', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ code, restaurants }),
        })
        if (cancelled || !res.body) return
        const doc = iframe.contentDocument
        if (!doc) return
        const head = `<base href="${location.origin}/" />`
        let full = head
        doc.open()
        doc.write(head)
        const reader = res.body.getReader()
        const dec = new TextDecoder()
        for (;;) {
          const { done, value } = await reader.read()
          if (cancelled) return
          if (done) {
            doc.close()
            break
          }
          if (!cancelled) setPending(false) // 最初のバイトが来たらローディングを消す
          const chunk = dec.decode(value, { stream: true })
          full += chunk
          doc.write(chunk)
          fit()
        }
        frameHtmlCache.set(code, full) // 完了した HTML をキャッシュ (再マウントで再利用)
        observeBody()
      })().catch(() => {})
    }
    return () => {
      cancelled = true
      clearInterval(timer)
      ro?.disconnect()
    }
  }, [code, restaurants])

  return (
    <div className='band-frame-wrap'>
      {pending && (
        <div className='band-frame__loading'>
          <span className='thinking-indicator__dots'>
            <span />
            <span />
            <span />
          </span>
          <span>お店を検索して Worker で SSR を準備中…</span>
        </div>
      )}
      <iframe
        ref={ref}
        className='band-frame'
        title='Dynamic Suspense SSR (streaming)'
        sandbox='allow-scripts allow-same-origin'
        style={pending ? { display: 'none' } : undefined}
      />
    </div>
  )
}
