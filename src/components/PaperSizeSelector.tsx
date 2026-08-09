import type { PaperSize, Point } from '../types'
import { PAPER_OPTIONS, paperSizeLabel } from '../utils/paper'

type Props = {
  value: PaperSize
  corners: [Point, Point, Point, Point]
  onChange: (value: PaperSize) => void
}

export const PaperSizeSelector = ({ value, corners, onChange }: Props) => (
  <label className="field">
    <span>用紙サイズ</span>
    <select
      className="target-select"
      value={value}
      onChange={(event) => onChange(event.target.value as PaperSize)}
      aria-label="用紙サイズ"
    >
      {PAPER_OPTIONS.map((option) => (
        <option key={option.key} value={option.key}>
          {option.key === 'auto' ? paperSizeLabel('auto', corners) : option.label}
        </option>
      ))}
    </select>
  </label>
)
