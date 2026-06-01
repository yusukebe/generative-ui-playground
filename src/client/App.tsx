import { Compare } from './Compare'
import { Gallery } from './Gallery'

// デモ本体は「4バンド比較」。/gallery で共有コンポーネントの一覧を見せる (別ページ)
export function App() {
  if (typeof window !== 'undefined' && window.location.pathname.startsWith('/gallery')) {
    return <Gallery />
  }
  return <Compare />
}
