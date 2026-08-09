import type { FilterMode } from '../types'

type Props = {
  filter: FilterMode
  clean: boolean
  onFilter: (filter: FilterMode) => void
  onToggleClean: () => void
}

const filters: { key: FilterMode; label: string }[] = [
  { key: 'auto', label: '自動' },
  { key: 'color', label: 'カラー' },
  { key: 'gray', label: 'グレー' },
  { key: 'bw', label: '白黒' }
]

export function FilterToolbar({ filter, clean, onFilter, onToggleClean }: Props) {
  return (
    <div className="filter-toolbar">
      <div className="chip-scroll">
        {filters.map((item) => (
          <button
            key={item.key}
            type="button"
            className={filter === item.key ? 'chip active' : 'chip'}
            onClick={() => onFilter(item.key)}
          >
            {item.label}
          </button>
        ))}
        <button type="button" className={clean ? 'chip active' : 'chip'} onClick={onToggleClean}>
          Clean {clean ? 'ON' : 'OFF'}
        </button>
      </div>
    </div>
  )
}
