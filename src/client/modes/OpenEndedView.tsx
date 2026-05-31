const CSP =
  "default-src 'none'; " +
  "script-src 'unsafe-inline'; " +
  "style-src 'unsafe-inline'; " +
  "img-src data:; " +
  "font-src data:; " +
  "connect-src 'none'; " +
  "object-src 'none'; " +
  "base-uri 'none'; " +
  "form-action 'none';"

function wrapHTML(html: string): string {
  const cspMeta = `<meta http-equiv="Content-Security-Policy" content="${CSP}">`
  if (/<head[^>]*>/i.test(html)) {
    return html.replace(/<head([^>]*)>/i, `<head$1>${cspMeta}`)
  }
  if (/<html[^>]*>/i.test(html)) {
    return html.replace(/<html([^>]*)>/i, `<html$1><head>${cspMeta}</head>`)
  }
  return `<!doctype html><html><head>${cspMeta}</head><body>${html}</body></html>`
}

export function OpenEndedView({ html }: { html: string }) {
  return (
    <iframe
      className="open-ended"
      sandbox="allow-scripts"
      srcDoc={wrapHTML(html)}
      title="Open-Ended generated UI"
    />
  )
}
