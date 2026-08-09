import { UI_FILTER_OPTIONS, normalizeFilter, type BookFlattenMode, type FilterMode } from '../types'

type Props = {
  filter: FilterMode
  clean: boolean
  bookFlatten: BookFlattenMode
  onFilter: (filter: FilterMode) => void
  onToggleClean: () => void
  onBookFlatten: (mode: BookFlattenMode) => void
}

const BOOK_FLATTEN_OPTIONS: { key: BookFlattenMode; label: string }[] = [
  { key: 'off', label: 'OFF' },
  { key: 'simple', label: '簡易' },
  { key: 'precise', label: '高精度' }
]

export function FilterToolbar({
  filter,
  clean,
  bookFlatten,
  onFilter,
  onToggleClean,
  onBookFlatten
}: Props) {
  const current = normalizeFilter(filter)
  const filterHint = UI_FILTER_OPTIONS.find((item) => item.key === current)?.hint ?? ''
  const bookHint =
    bookFlatten === 'precise'
      ? '円筒3D＋行カーブ。背や行の信頼度が低いときは自動で簡易に切替'
      : bookFlatten === 'simple'
        ? '軽量な横方向の反り補正（通常書類にも比較的安全）'
        : clean
          ? '紙の汚れ・ボールペン寄りの跡を抑え、文字をシャープにします'
          : filterHint

  return (
    <div className="filter-toolbar compact">
      <div className="chip-scroll">
        {UI_FILTER_OPTIONS.map((item) => (
          <button
            key={item.key}
            type="button"
            className={current === item.key ? 'chip active' : 'chip'}
            onClick={() => onFilter(item.key)}
          >
            {item.label}
          </button>
        ))}
        <button
          type="button"
          className={clean ? 'chip active' : 'chip'}
          onClick={onToggleClean}
          aria-pressed={clean}
        >
          汚れ除去 {clean ? 'ON' : 'OFF'}
        </button>
      </div>

      <div className="book-flatten-row" role="group" aria-label="本の反り">
        <span className="book-flatten-label">本の反り</span>
        <div className="chip-scroll book-flatten-chips">
          {BOOK_FLATTEN_OPTIONS.map((item) => (
            <button
              key={item.key}
              type="button"
              className={bookFlatten === item.key ? 'chip active' : 'chip'}
              aria-pressed={bookFlatten === item.key}
              onClick={() => onBookFlatten(item.key)}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      {bookHint && <p className="filter-hint">{bookHint}</p>}
    </div>
  )
}
