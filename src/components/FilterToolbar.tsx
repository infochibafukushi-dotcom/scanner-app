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
  const filterHint = UI_FILTER_OPTIONS.find((item) => item.key === current)?.hint ?? ''
  const extraHint = flattenBook
    ? '本の背付近のゆるい反りを広げ、中央の暗さも少し持ち上げます'
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
        <button
          type="button"
          className={flattenBook ? 'chip active' : 'chip'}
          onClick={onToggleFlattenBook}
          aria-pressed={flattenBook}
          title="本のゆるいカーブを補正"
        >
          本の反り {flattenBook ? 'ON' : 'OFF'}
        </button>
      </div>
      {extraHint && <p className="filter-hint">{extraHint}</p>}
    </div>
  )
}
