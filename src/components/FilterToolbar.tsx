import { UI_FILTER_OPTIONS, normalizeFilter, type FilterMode } from '../types'

type Props = {
  filter: FilterMode
  clean: boolean
  flattenBook: boolean
  onFilter: (filter: FilterMode) => void
  onToggleClean: () => void
  onToggleFlattenBook: () => void
}

export function FilterToolbar({
  filter,
  clean,
  flattenBook,
  onFilter,
  onToggleClean,
  onToggleFlattenBook
}: Props) {
  const current = normalizeFilter(filter)
  const hint =
    UI_FILTER_OPTIONS.find((item) => item.key === current)?.hint ??
    (clean ? '汚れ・手書き寄りの跡を軽減しシャープに' : '')

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
        <button type="button" className={clean ? 'chip active' : 'chip'} onClick={onToggleClean}>
          Clean {clean ? 'ON' : 'OFF'}
        </button>
        <button
          type="button"
          className={flattenBook ? 'chip active' : 'chip'}
          onClick={onToggleFlattenBook}
          title="見開き本のゆるいカーブを補正"
        >
          本カーブ {flattenBook ? 'ON' : 'OFF'}
        </button>
      </div>
      {hint && <p className="filter-hint">{hint}</p>}
      {flattenBook && <p className="filter-hint">本のゆるい反りを広げて読みやすくします</p>}
    </div>
  )
}
