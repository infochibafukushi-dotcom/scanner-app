import type { EditTool } from '../types'

type Props = {
  value: EditTool
  onChange: (tool: EditTool) => void
}

const tools: { key: EditTool; label: string; icon: string }[] = [
  { key: 'crop', label: '切抜き', icon: '✂' },
  { key: 'filter', label: 'フィルター', icon: '◐' },
  { key: 'rotate', label: '回転', icon: '↻' },
  { key: 'ocr', label: '文字読取', icon: 'あ' }
]

export function EditToolbar({ value, onChange }: Props) {
  return (
    <nav className="edit-main-toolbar" aria-label="編集ツール">
      {tools.map((tool) => (
        <button
          key={tool.key}
          type="button"
          className={value === tool.key ? 'active' : ''}
          onClick={() => onChange(tool.key)}
          aria-label={tool.label}
        >
          <span className="tool-icon" aria-hidden>
            {tool.icon}
          </span>
          <span>{tool.label}</span>
        </button>
      ))}
    </nav>
  )
}
