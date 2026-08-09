import { UI_FILTER_OPTIONS, normalizeFilter, type FilterMode } from '../types'

type Props = {
  filter: FilterMode
  clean: boolean
  onFilter: (filter: FilterMode) => void
  onToggleClean: () => void
}

export function FilterToolbar({ filter, clean, onFilter, onToggleClean }: Props) {
  const current = normalizeFilter(filter)
  const hint = UI_FILTER_OPTIONS.find((item) => item.key === current)?.hint ?? ''

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
      </div>
      {hint && <p className="filter-hint">{hint}</p>}
    </div>
  )
}
