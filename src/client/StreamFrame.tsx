import { useEffect, useRef } from 'react'

/**
 * Dynamic の Suspense SSR フレーム (本物のストリーミング)。
 * fetch で Worker の renderToReadableStream 出力を取得 (Vite dev の SPA フォールバックを回避) し、
 * チャンクを iframe へ document.write で逐次流し込む。ブラウザがネイティブに React ストリームを
 * パース → Suspense 境界が解決するたびにカードが現れる ($RC reveal)。
 * iframe は中身の高さに自動フィット (same-origin なので body.scrollHeight で測れる)。
 */
export function StreamFrame({ url }: { url: string }) {
  const ref = useRef<HTMLIFrameElement>(null)
  useEffect(() => {
    const iframe = ref.current
    if (!iframe) return
    let cancelled = false
    let ro: ResizeObserver | null = null
    let lastH = 0
    const fit = () => {
      const doc = iframe.contentDocument
      const b = doc?.body
      // body.scrollHeight は viewport にクランプされず実コンテンツ高を返す
      const h = Math.max(b?.scrollHeight ?? 0, b?.offsetHeight ?? 0)
      if (h > 0 && h !== lastH) {
        iframe.style.height = `${h}px`
        // 伸びている間だけ下端を画面内へ追従 (Suspense でカードが流れてくるのが見える)
        if (h > lastH) iframe.scrollIntoView({ block: 'end' })
        lastH = h
      }
    }
    const timer = setInterval(fit, 200)
    ;(async () => {
      const res = await fetch(url)
      if (cancelled || !res.body) return
      const doc = iframe.contentDocument
      if (!doc) return
      doc.open()
      doc.write(`<base href="${location.origin}/" />`)
      const reader = res.body.getReader()
      const dec = new TextDecoder()
      for (;;) {
        const { done, value } = await reader.read()
        if (cancelled) return
        if (done) {
          doc.close()
          break
        }
        doc.write(dec.decode(value, { stream: true }))
        fit()
      }
      // body の変化(カード追加・画像読込)に追従
      if (doc.body && 'ResizeObserver' in window) {
        ro = new ResizeObserver(fit)
        ro.observe(doc.body)
      }
      setTimeout(fit, 500)
      setTimeout(fit, 1500)
    })().catch(() => {})
    return () => {
      cancelled = true
      clearInterval(timer)
      ro?.disconnect()
    }
  }, [url])

  return (
    <iframe
      ref={ref}
      className='band-frame'
      title='Dynamic Suspense SSR (streaming)'
      sandbox='allow-scripts allow-same-origin'
    />
  )
}
