import { useMemo, type AnchorHTMLAttributes, type ReactNode } from 'react'
import { Fragment, jsx, jsxs } from 'react/jsx-runtime'
import type { Root as HastRoot } from 'hast'
import { toJsxRuntime } from 'hast-util-to-jsx-runtime'
import type { PluggableList } from 'unified'
import { unified } from 'unified'
import type { Components } from 'react-markdown'
import Markdown from 'react-markdown'
import rehypeParse from 'rehype-parse'
import rehypeRaw from 'rehype-raw'
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize'
import remarkGfm from 'remark-gfm'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { VFile } from 'vfile'
import {
  buildWebPath,
  entityLinkKindToApp,
  parseKiraEntitySegments,
  type KiraEntityLinkKind,
} from '@sombra/shared'

import './KiraRichMessage.css'

/** Block-level HTML tables: markdown often leaves these as plain text; parse separately. */
const HTML_TABLE_BLOCK_RE = /<table\b[^>]*>[\s\S]*?<\/table>/gi

/** Custom client-side token wrapping Kira's final recommendation; rendered as a highlighted block. */
const FAZIT_BLOCK_RE = /\[\[fazit\]\]([\s\S]*?)\[\[\/fazit\]\]/gi

type FazitChunk = { kind: 'fazit' | 'plain'; value: string }

function splitFazitBlocks(text: string): FazitChunk[] {
  const out: FazitChunk[] = []
  let last = 0
  const re = new RegExp(FAZIT_BLOCK_RE.source, 'gi')
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) {
      const head = text.slice(last, m.index)
      if (head) out.push({ kind: 'plain', value: head })
    }
    const body = (m[1] ?? '').trim()
    if (body) out.push({ kind: 'fazit', value: body })
    last = m.index + m[0].length
  }
  if (last < text.length) {
    const tail = text.slice(last)
    if (tail) out.push({ kind: 'plain', value: tail })
  }
  if (out.length === 0) out.push({ kind: 'plain', value: text })
  return out
}

function splitMarkdownAndHtmlTables(text: string): Array<
  { kind: 'markdown'; value: string } | { kind: 'html'; value: string }
> {
  const out: Array<
    { kind: 'markdown'; value: string } | { kind: 'html'; value: string }
  > = []
  let last = 0
  const re = new RegExp(HTML_TABLE_BLOCK_RE.source, 'gi')
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) {
      const md = text.slice(last, m.index)
      if (md) out.push({ kind: 'markdown', value: md })
    }
    out.push({ kind: 'html', value: m[0] })
    last = m.index + m[0].length
  }
  if (last < text.length) {
    const tail = text.slice(last)
    if (tail) out.push({ kind: 'markdown', value: tail })
  }
  if (out.length === 0) out.push({ kind: 'markdown', value: text })
  return out
}

function linkLabelKey(entity: KiraEntityLinkKind): string {
  switch (entity) {
    case 'asset':
      return 'kira.link_open_asset'
    case 'workgroup':
      return 'kira.link_open_workgroup'
    case 'work_order':
      return 'kira.link_open_work_order'
  }
}

/** External / safe links open in a new tab; same-origin relative paths stay in-app. */
function KiraMarkdownLink({
  href,
  children,
  ...rest
}: AnchorHTMLAttributes<HTMLAnchorElement>) {
  if (!href) return <span>{children}</span>
  const h = href.trim()
  const lower = h.toLowerCase()
  if (
    lower.startsWith('http://') ||
    lower.startsWith('https://') ||
    lower.startsWith('mailto:')
  ) {
    return (
      <a href={h} target="_blank" rel="noopener noreferrer" {...rest}>
        {children}
      </a>
    )
  }
  if (h.startsWith('/') && !h.startsWith('//')) {
    return (
      <Link to={h} className={rest.className}>
        {children}
      </Link>
    )
  }
  return <span {...rest}>{children}</span>
}

const markdownComponents: Components = {
  a: KiraMarkdownLink,
  table: ({ children, ...rest }) => (
    <div className="kira-md-table-wrap">
      <table {...rest}>{children}</table>
    </div>
  ),
}

const jsxRuntimeTable = {
  table: ({
    children,
    ...rest
  }: React.HTMLAttributes<HTMLTableElement> & { node?: unknown }) => (
    <div className="kira-md-table-wrap">
      <table {...rest}>{children}</table>
    </div>
  ),
  a: KiraMarkdownLink,
}

/** Raw HTML parsed then GitHub-style sanitized (tables, emphasis, etc.). */
const kiraRehypePlugins: PluggableList = [
  rehypeRaw,
  [rehypeSanitize, defaultSchema],
]

function renderSanitizedHtmlFragment(html: string): ReactNode {
  try {
    const processor = unified()
      .use(rehypeParse, { fragment: true })
      .use(rehypeSanitize, defaultSchema)
    const file = new VFile(html)
    const tree = processor.runSync(processor.parse(file), file) as HastRoot
    return toJsxRuntime(tree, {
      Fragment,
      jsx,
      jsxs,
      ignoreInvalidStyle: true,
      passKeys: true,
      passNode: true,
      elementAttributeNameCase: 'react',
      components: jsxRuntimeTable,
    })
  } catch {
    return <span className="text-color-secondary">{html}</span>
  }
}

function KiraTextSegment({ value }: { value: string }) {
  const chunks = useMemo(() => splitMarkdownAndHtmlTables(value), [value])
  return (
    <>
      {chunks.map((c, j) =>
        c.kind === 'markdown' ? (
          <Markdown
            key={`md-${j}`}
            remarkPlugins={[remarkGfm]}
            rehypePlugins={kiraRehypePlugins}
            components={markdownComponents}
          >
            {c.value}
          </Markdown>
        ) : (
          <div key={`html-${j}`} className="kira-html-table-root">
            {renderSanitizedHtmlFragment(c.value)}
          </div>
        ),
      )}
    </>
  )
}

function KiraEntityAwareChunk({ text }: { text: string }) {
  const { t } = useTranslation()
  const segments = useMemo(() => parseKiraEntitySegments(text), [text])
  return (
    <>
      {segments.map((s, i) => {
        if (s.kind === 'text') {
          return (
            <div key={i} className="kira-md-root">
              <KiraTextSegment value={s.value} />
            </div>
          )
        }
        const app = entityLinkKindToApp(s.entity)
        const { pathname, search } = buildWebPath(app, s.id)
        const to = `${pathname}${search}`
        return (
          <Fragment key={i}>
            <Link
              to={to}
              className="text-primary font-medium underline inline-block align-baseline"
            >
              {t(linkLabelKey(s.entity))}
            </Link>
          </Fragment>
        )
      })}
    </>
  )
}

/** Renders `[[asset:uuid]]`-style tokens as in-app deep links; text runs as GFM Markdown + sanitized HTML. */
export function KiraRichMessage({ content }: { content: string }) {
  const chunks = useMemo(() => splitFazitBlocks(content), [content])

  return (
    <div className="kira-rich-message text-sm line-height-3">
      {chunks.map((c, i) =>
        c.kind === 'fazit' ? (
          <div
            key={`fazit-${i}`}
            className="kira-fazit"
            role="note"
            aria-label="Fazit"
          >
            <KiraEntityAwareChunk text={c.value} />
          </div>
        ) : (
          <KiraEntityAwareChunk key={`plain-${i}`} text={c.value} />
        ),
      )}
    </div>
  )
}
