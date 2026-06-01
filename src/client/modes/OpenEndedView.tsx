import { useEffect, useRef, useState } from 'react'

const CSP =
  "default-src 'none'; " +
  "script-src 'unsafe-inline'; " +
  "style-src 'unsafe-inline'; " +
  // 自前プロキシ (/api/places-photo) の写真を許可。connect-src は none のままなので
  // スクリプトからのデータ送信は遮断される (画像表示のみ許可)
  'img-src data: https: http:; ' +
  'font-src data:; ' +
  "connect-src 'none'; " +
  "object-src 'none'; " +
  // srcdoc には base URL が無いので、写真の相対URL(/api/places-photo) を解決するため
  // <base href=origin> を注入する。そのため base-uri は self を許可する
  "base-uri 'self'; " +
  "form-action 'none';"

// iframe が中身の高さを親へ通知するスクリプト (箱っぽさを消して地続きに見せる)
const HEIGHT_REPORTER = `<script>
(function(){function send(){parent.postMessage({__oeHeight:document.documentElement.scrollHeight},'*')}
new ResizeObserver(send).observe(document.documentElement);
addEventListener('load',send);setTimeout(send,300);setTimeout(send,1200);send();})()
</script>`

function wrapHTML(html: string): string {
  // srcdoc は base URL を持たないので、相対の写真URL(/api/places-photo)を解決するため base を入れる
  const base = `<base href="${window.location.origin}/">`
  const inject = `<meta http-equiv="Content-Security-Policy" content="${CSP}">${base}`
  let out: string
  if (/<head[^>]*>/i.test(html)) out = html.replace(/<head([^>]*)>/i, `<head$1>${inject}`)
  else if (/<html[^>]*>/i.test(html))
    out = html.replace(/<html([^>]*)>/i, `<html$1><head>${inject}</head>`)
  else out = `<!doctype html><html><head>${inject}</head><body>${html}</body></html>`
  // </body> 直前に高さ通知スクリプトを差し込む
  return /<\/body>/i.test(out)
    ? out.replace(/<\/body>/i, `${HEIGHT_REPORTER}</body>`)
    : out + HEIGHT_REPORTER
}

export function OpenEndedView({ html }: { html: string }) {
  const ref = useRef<HTMLIFrameElement>(null)
  const [height, setHeight] = useState(0)
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      if (e.source !== ref.current?.contentWindow) return
      const h = (e.data as { __oeHeight?: number })?.__oeHeight
      if (typeof h === 'number' && h > 0) setHeight(h)
    }
    window.addEventListener('message', onMsg)
    return () => window.removeEventListener('message', onMsg)
  }, [])
  return (
    <iframe
      ref={ref}
      className='band-frame'
      sandbox='allow-scripts'
      srcDoc={wrapHTML(html)}
      title='Open-Ended generated UI'
      style={height ? { height } : undefined}
    />
  )
}
