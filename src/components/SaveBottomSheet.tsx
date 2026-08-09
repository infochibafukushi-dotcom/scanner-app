import { BottomSheet } from './BottomSheet'

type Props = {
  open: boolean
  fileName: string
  busy: boolean
  statusMessage: string
  disabled: boolean
  onClose: () => void
  onFileNameChange: (value: string) => void
  onSavePdf: () => void
  onSaveJpeg: () => void
  onSaveText: () => void
  onSaveWord: () => void
  onShare: () => void
  onShareGpt: () => void
}

export function SaveBottomSheet({
  open,
  fileName,
  busy,
  statusMessage,
  disabled,
  onClose,
  onFileNameChange,
  onSavePdf,
  onSaveJpeg,
  onSaveText,
  onSaveWord,
  onShare,
  onShareGpt
}: Props) {
  return (
    <BottomSheet open={open} title="保存・共有" onClose={onClose} tall>
      <label className="field">
        <span>ファイル名</span>
        <input
          value={fileName}
          onChange={(event) => onFileNameChange(event.target.value)}
          disabled={busy}
          inputMode="text"
        />
      </label>

      {statusMessage && <div className="sheet-status">{statusMessage}</div>}

      <div className="save-grid">
        <button type="button" onClick={onSavePdf} disabled={disabled || busy}>
          PDF
        </button>
        <button type="button" onClick={onSaveJpeg} disabled={disabled || busy}>
          JPEG
        </button>
        <button type="button" onClick={onSaveText} disabled={disabled || busy}>
          TXT
        </button>
        <button type="button" onClick={onSaveWord} disabled={disabled || busy}>
          Word
        </button>
        <button type="button" onClick={onShare} disabled={disabled || busy}>
          共有
        </button>
        <button type="button" onClick={onShareGpt} disabled={disabled || busy}>
          ChatGPTへ共有
        </button>
      </div>
      <p className="helper-text">共有は LINE・メール・Drive など端末の共有機能を使います。</p>
    </BottomSheet>
  )
}
