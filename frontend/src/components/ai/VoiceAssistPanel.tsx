/**
 * MVP: browser STT (Web Speech API) + server AI draft. User must review and save the form.
 * Unresolved UUIDs: server returns candidates; this panel shows hints only — user picks in form.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from 'primereact/button'
import { InputTextarea } from 'primereact/inputtextarea'
import { Message } from 'primereact/message'
import { ApiError, apiJson } from '../../api'

export type AiRefRow = { id: string; key: string; name: string }

export type AiSuggestWoValidated = {
  short_text: string | null
  instruction_text: string | null
  asset_id: string | null
  work_type_id: string | null
  workgroup_id: string | null
  category_id: string | null
  planned_duration: number | null
  plan_start: string | null
}

export type AiSuggestAssetValidated = {
  key: string | null
  name: string | null
  asset_type:
    | 'location'
    | 'building'
    | 'group'
    | 'maintenance_object'
    | null
  parent_asset_id: string | null
  costcenter_id: string | null
  asset_classification_id: string | null
  equipment_number: string | null
  serial_no: string | null
  build_year: number | null
  warranty_end: string | null
  priority: number | null
}

type AiCandidate = { id: string; label: string; score: number }

type SuggestResponseBase = {
  transcript_echo: string
  unresolved: string[]
  candidates: Record<string, AiCandidate[]>
  warnings: string[]
}

type SuggestWoResponse = SuggestResponseBase & {
  kind: 'work_order'
  validated: AiSuggestWoValidated
}

type SuggestAssetResponse = SuggestResponseBase & {
  kind: 'asset'
  validated: AiSuggestAssetValidated
}

type SpeechRecCtor = new () => {
  lang: string
  continuous: boolean
  interimResults: boolean
  onresult: ((ev: Event) => void) | null
  onerror: ((ev: Event) => void) | null
  onend: (() => void) | null
  start: () => void
  stop: () => void
}

function getSpeechRecognition(): SpeechRecCtor | null {
  if (typeof window === 'undefined') return null
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecCtor
    webkitSpeechRecognition?: SpeechRecCtor
  }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

type PropsWo = {
  kind: 'work_order'
  disabled?: boolean
  /** When true, only blocks "Apply AI" (browser dictation still works). */
  suggestDisabled?: boolean
  context: {
    assets: AiRefRow[]
    work_types: AiRefRow[]
    workgroups: AiRefRow[]
    categories: AiRefRow[]
  }
  onApplyValidated: (v: AiSuggestWoValidated) => void
  onError: (msg: string) => void
}

type PropsAsset = {
  kind: 'asset'
  disabled?: boolean
  /** When true, only blocks "Apply AI" (browser dictation still works). */
  suggestDisabled?: boolean
  context: {
    assets: AiRefRow[]
    costcenters: AiRefRow[]
    asset_classifications: AiRefRow[]
  }
  onApplyValidated: (v: AiSuggestAssetValidated) => void
  onError: (msg: string) => void
}

export type VoiceAssistPanelProps = PropsWo | PropsAsset

export function VoiceAssistPanel(props: VoiceAssistPanelProps) {
  const { t } = useTranslation()
  const [transcript, setTranscript] = useState('')
  const [listening, setListening] = useState(false)
  const [suggesting, setSuggesting] = useState(false)
  const [lastHints, setLastHints] = useState<string | null>(null)
  const recRef = useRef<InstanceType<SpeechRecCtor> | null>(null)

  const [speechAvailable, setSpeechAvailable] = useState(false)
  useEffect(() => {
    setSpeechAvailable(getSpeechRecognition() != null)
  }, [])

  useEffect(() => {
    return () => {
      try {
        recRef.current?.stop()
      } catch {
        /* ignore */
      }
      recRef.current = null
    }
  }, [])

  const startListen = useCallback(() => {
    const Ctor = getSpeechRecognition()
    if (!Ctor) {
      props.onError(t('ai.stt_unsupported'))
      return
    }
    const r = new Ctor()
    r.lang = document.documentElement.lang?.trim() || 'en-US'
    r.continuous = true
    r.interimResults = true
    r.onresult = (ev: Event) => {
      const e = ev as unknown as {
        results: { length: number; [i: number]: { 0: { transcript: string } } }
      }
      let text = ''
      for (let i = 0; i < e.results.length; i++) {
        text += e.results[i][0]?.transcript ?? ''
      }
      setTranscript(text.trim())
    }
    r.onerror = () => {
      setListening(false)
    }
    r.onend = () => {
      setListening(false)
    }
    recRef.current = r
    try {
      r.start()
      setListening(true)
    } catch {
      props.onError(t('ai.stt_unsupported'))
    }
  }, [props, t])

  const stopListen = useCallback(() => {
    try {
      recRef.current?.stop()
    } catch {
      /* ignore */
    }
    recRef.current = null
    setListening(false)
  }, [])

  const runSuggest = useCallback(async () => {
    const text = transcript.trim()
    if (!text) {
      props.onError(t('ai.err_empty_transcript'))
      return
    }
    setSuggesting(true)
    setLastHints(null)
    try {
      if (props.kind === 'work_order') {
        const body = {
          kind: 'work_order' as const,
          transcript: text,
          context: {
            assets: props.context.assets.map((a) => ({
              id: a.id,
              key: a.key,
              name: a.name,
            })),
            work_types: props.context.work_types.map((x) => ({
              id: x.id,
              key: x.key,
              name: x.name,
            })),
            workgroups: props.context.workgroups.map((x) => ({
              id: x.id,
              key: x.key,
              name: x.name,
            })),
            categories: props.context.categories.map((x) => ({
              id: x.id,
              key: x.key,
              name: x.name,
            })),
          },
        }
        const data = await apiJson<SuggestWoResponse>('/api/ai/suggest', {
          method: 'POST',
          body: JSON.stringify(body),
        })
        props.onApplyValidated(data.validated)
        const hints: string[] = []
        if (data.unresolved.length) {
          hints.push(
            `${t('ai.unresolved_prefix')}: ${data.unresolved.join(', ')}`,
          )
        }
        for (const [field, cands] of Object.entries(data.candidates)) {
          if (!cands?.length) continue
          const top = cands
            .slice(0, 3)
            .map((c) => c.label)
            .join('; ')
          hints.push(`${field}: ${top}`)
        }
        if (data.warnings.length) {
          hints.push(...data.warnings)
        }
        setLastHints(hints.length ? hints.join('\n') : null)
      } else {
        const body = {
          kind: 'asset' as const,
          transcript: text,
          context: {
            assets: props.context.assets.map((a) => ({
              id: a.id,
              key: a.key,
              name: a.name,
            })),
            costcenters: props.context.costcenters.map((x) => ({
              id: x.id,
              key: x.key,
              name: x.name,
            })),
            asset_classifications: props.context.asset_classifications.map(
              (x) => ({
                id: x.id,
                key: x.key,
                name: x.name,
              }),
            ),
          },
        }
        const data = await apiJson<SuggestAssetResponse>('/api/ai/suggest', {
          method: 'POST',
          body: JSON.stringify(body),
        })
        props.onApplyValidated(data.validated)
        const hints: string[] = []
        if (data.unresolved.length) {
          hints.push(
            `${t('ai.unresolved_prefix')}: ${data.unresolved.join(', ')}`,
          )
        }
        for (const [field, cands] of Object.entries(data.candidates)) {
          if (!cands?.length) continue
          const top = cands
            .slice(0, 3)
            .map((c) => c.label)
            .join('; ')
          hints.push(`${field}: ${top}`)
        }
        if (data.warnings.length) {
          hints.push(...data.warnings)
        }
        setLastHints(hints.length ? hints.join('\n') : null)
      }
    } catch (e) {
      if (e instanceof ApiError) {
        props.onError(e.message)
      } else {
        props.onError(t('ai.suggest_failed'))
      }
    } finally {
      setSuggesting(false)
    }
  }, [props, transcript, t])

  return (
    <div className="border-1 border-round-md surface-border p-3 mb-3 surface-ground">
      <div className="flex align-items-center gap-2 mb-2">
        <i className="pi pi-microphone" aria-hidden />
        <span className="text-sm font-semibold">{t('ai.voice_title')}</span>
      </div>
      <p className="text-xs text-color-secondary m-0 mb-2">{t('ai.voice_hint')}</p>
      {!speechAvailable ? (
        <p className="text-xs text-color-secondary m-0 mb-2">{t('ai.stt_browser_unavailable')}</p>
      ) : null}
      <label htmlFor="ai-transcript" className="text-sm font-medium block mb-1">
        {t('ai.transcript_label')}
      </label>
      <InputTextarea
        id="ai-transcript"
        value={transcript}
        onChange={(e) => setTranscript(e.target.value)}
        rows={4}
        className="w-full"
        disabled={props.disabled ?? false}
        autoResize
      />
      <div className="flex flex-wrap gap-2 mt-2">
        {!listening ? (
          <Button
            type="button"
            icon="pi pi-microphone"
            label={t('ai.listen')}
            severity="secondary"
            outlined
            disabled={(props.disabled ?? false) || !speechAvailable}
            onClick={startListen}
          />
        ) : (
          <Button
            type="button"
            icon="pi pi-stop"
            label={t('ai.stop')}
            severity="danger"
            outlined
            onClick={stopListen}
          />
        )}
        <Button
          type="button"
          icon="pi pi-sparkles"
          label={t('ai.apply_suggest')}
          loading={suggesting}
          disabled={
            (props.disabled ?? false) ||
            (props.suggestDisabled ?? false) ||
            suggesting
          }
          onClick={() => void runSuggest()}
        />
      </div>
      {lastHints ? (
        <Message severity="info" text={lastHints} className="mt-2 w-full" />
      ) : null}
    </div>
  )
}
