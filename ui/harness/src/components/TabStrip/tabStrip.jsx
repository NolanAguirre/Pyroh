import { Fragment, useEffect, useRef } from 'react'
import { DevScope } from 'component-library'
import './styles.css'

const scrollIntoStrip = (strip, tab, horizontal) => {
  if (horizontal) {
    const left = tab.offsetLeft
    const right = left + tab.offsetWidth
    if (left < strip.scrollLeft) strip.scrollLeft = left
    else if (right > strip.scrollLeft + strip.clientWidth) strip.scrollLeft = right - strip.clientWidth
    return
  }
  const top = tab.offsetTop
  const bottom = top + tab.offsetHeight
  if (top < strip.scrollTop) strip.scrollTop = top
  else if (bottom > strip.scrollTop + strip.clientHeight) strip.scrollTop = bottom - strip.clientHeight
}

const TabRenameInput = ({ value = '', commit = () => {}, cancel = () => {} }) => {
  const inputRef = useRef(null)
  const doneRef = useRef(false)
  const armedRef = useRef(false)

  useEffect(() => {
    const input = inputRef.current
    if (!input) return undefined
    input.focus({ preventScroll: true })
    input.select()
    const frame = requestAnimationFrame(() => {
      armedRef.current = true
      if (document.activeElement !== input) {
        input.focus({ preventScroll: true })
        input.select()
      }
    })
    return () => cancelAnimationFrame(frame)
  }, [])

  const finish = async (event, action) => {
    event.preventDefault()
    event.stopPropagation()
    if (doneRef.current) return
    doneRef.current = true
    const result = action()
    const ok = result && typeof result.then === 'function' ? await result : result
    if (ok === false) {
      doneRef.current = false
      inputRef.current?.focus()
    }
  }

  return (
    <input
      ref={inputRef}
      className="tab-strip__rename"
      type="text"
      defaultValue={value}
      aria-label="Rename tab"
      spellCheck={false}
      autoComplete="off"
      onKeyDown={(event) => {
        event.stopPropagation()
        if (event.key === 'Enter') finish(event, () => commit(event.currentTarget.value))
        else if (event.key === 'Escape') finish(event, () => cancel())
      }}
      onBlur={(event) => {
        if (doneRef.current || !armedRef.current) return
        finish(event, () => commit(event.currentTarget.value))
      }}
      onClick={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
    />
  )
}

const GROUP_COLORS = [
  '#f59e0b',
  '#34d399',
  '#38bdf8',
  '#f472b6',
  '#a78bfa',
  '#fb7185',
  '#2dd4bf',
  '#facc15',
]

const sectionKey = (item) => (item.sectionId == null || item.sectionId === '' ? '' : String(item.sectionId))

const clusterSection = (sectionItems) => {
  const seen = new Set()
  const clustered = []
  sectionItems.forEach((item) => {
    const groupId = item.groupId || null
    if (!groupId) {
      clustered.push(item)
      return
    }
    if (seen.has(groupId)) return
    seen.add(groupId)
    sectionItems.forEach((member) => {
      if ((member.groupId || null) === groupId) clustered.push(member)
    })
  })
  return clustered
}

const clusterByGroup = (items) => {
  const sections = []
  const indexBySection = new Map()
  items.forEach((item) => {
    const key = sectionKey(item)
    let index = indexBySection.get(key)
    if (index == null) {
      index = sections.length
      indexBySection.set(key, index)
      sections.push([])
    }
    sections[index].push(item)
  })
  return sections.flatMap(clusterSection)
}

const groupColors = (items) => {
  const colors = new Map()
  items.forEach((item) => {
    if (!item.groupId || colors.has(item.groupId)) return
    colors.set(item.groupId, item.groupColor || GROUP_COLORS[colors.size % GROUP_COLORS.length])
  })
  return colors
}

/**
 * TabStrip — stateless, controlled, id-keyed editor tabs.
 *
 * `orientation` is `vertical` (side bar) or `horizontal` (top bar). The active
 * tab is scrolled into view when it changes. Dirty tabs show a dot in place of
 * the close button until hovered. Middle-click closes a tab. Arrow Up and Arrow
 * Down move between vertical tabs; Arrow Left and Arrow Right move between
 * horizontal tabs.
 *
 * Props:
 *   items       {object[]} — [{ id, label, title, dirty, icon, sectionId, sectionName,
 *                    groupId, groupColor, groupName, editing, editValue, onEditCommit,
 *                    onEditCancel, onDoubleClick }]
 *   activeId    {string}   — id of the active tab
 *   select      {function} — (id) activates a tab
 *   close       {function} — (id) closes a tab; omit to hide close buttons
 *   closeAll    {function} — closes every tab; omit to hide the footer action
 *   orientation {string}   — 'vertical' | 'horizontal' (default: 'vertical')
 *   className   {string}
 *   devId       {string}   — instance-root DevScope id
 *
 * Double-click or F2 calls onDoubleClick. While `editing` is set, the label is
 * an input: Enter or blur calls onEditCommit(value), Escape calls onEditCancel.
 * onEditCommit may return false (or a promise of false) to keep the input open.
 *
 * Items that share a sectionId are drawn together under a sectionName label.
 * Within a section, items that share a groupId are drawn together. Each group
 * uses one left border color, from groupColor when set, and a groupName label
 * above its first tab. A contextMenu from ContextMenu
 * opens on a tab's contextmenu with { id }, and on the strip itself with
 * { strip: true }.
 */
const TabStrip = ({
  items = [],
  activeId,
  select = () => {},
  close,
  closeAll,
  orientation = 'vertical',
  className,
  devId,
  contextMenu,
}) => {
  const stripRef = useRef(null)
  const horizontal = orientation === 'horizontal'

  useEffect(() => {
    const strip = stripRef.current
    if (!strip || activeId == null) return
    const tab = strip.querySelector('.tab-strip__tab--active')
    if (tab) scrollIntoStrip(strip, tab, horizontal)
  }, [activeId, items.length, horizontal])

  const displayItems = clusterByGroup(items)
  const colors = groupColors(displayItems)

  const focusTab = (index) => {
    const tabs = stripRef.current?.querySelectorAll('.tab-strip__tab')
    tabs?.[index]?.focus()
  }

  const handleKeyDown = (event, index) => {
    if (event.target.closest('.tab-strip__rename')) return
    const item = displayItems[index]
    if (item.editing) return
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      select(item.id)
      return
    }
    if (event.key === 'Delete' && close) {
      event.preventDefault()
      close(item.id)
      return
    }
    if (event.key === 'F2' && typeof item.onDoubleClick === 'function') {
      event.preventDefault()
      item.onDoubleClick(item.id)
      return
    }
    const step = horizontal
      ? (event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0)
      : (event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0)
    if (!step || displayItems.length === 0) return
    event.preventDefault()
    const next = (index + step + displayItems.length) % displayItems.length
    select(displayItems[next].id)
    focusTab(next)
  }

  const classes = ['tab-strip', horizontal && 'tab-strip--horizontal', !closeAll && className].filter(Boolean).join(' ')

  const strip = (
    <div
      ref={stripRef}
      className={classes}
      role="tablist"
      aria-orientation={horizontal ? 'horizontal' : 'vertical'}
      onContextMenu={(event) => {
        if (!contextMenu) return
        if (event.target.closest('.tab-strip__tab')) return
        contextMenu.open(event, { strip: true })
      }}
    >
      {displayItems.map((item, index) => {
        const isActive = item.id === activeId
        const groupId = item.groupId || null
        const sectionId = item.sectionId || null
        const prev = index > 0 ? displayItems[index - 1] : null
        const prevGroup = prev && (prev.sectionId || null) === sectionId ? prev.groupId || null : null
        const prevSection = prev ? prev.sectionId || null : null
        const showSectionHeader = Boolean(item.sectionName && sectionId !== prevSection)
        const tabClasses = [
          'tab-strip__tab',
          isActive && 'tab-strip__tab--active',
          item.dirty && 'tab-strip__tab--dirty',
          item.editing && 'tab-strip__tab--editing',
          groupId && 'tab-strip__tab--group',
          groupId && prevGroup !== groupId && index > 0 && !item.groupName && 'tab-strip__tab--group-start',
        ]
          .filter(Boolean)
          .join(' ')
        const labelText = typeof item.label === 'string' ? item.label : undefined
        const groupColor = groupId ? colors.get(groupId) : undefined
        const showGroupHeader = Boolean(groupId && prevGroup !== groupId && item.groupName)

        return (
          <Fragment key={item.id}>
          {showSectionHeader && (
            <div className="tab-strip__section" title={item.sectionName}>
              <span className="tab-strip__section-label">{item.sectionName}</span>
            </div>
          )}
          {showGroupHeader && (
            <div
              className="tab-strip__group"
              style={groupColor ? { '--tab-group-color': groupColor } : undefined}
              title={item.groupName}
            >
              <span className="tab-strip__group-label">{item.groupName}</span>
            </div>
          )}
          <DevScope id="tpbx9h6" state={{ tab: item.id, active: isActive, dirty: Boolean(item.dirty), editing: Boolean(item.editing), groupId }}>
            <div
              className={tabClasses}
              style={groupColor ? { '--tab-group-color': groupColor } : undefined}
              role="tab"
              aria-selected={isActive}
              tabIndex={isActive ? 0 : -1}
              title={item.editing ? undefined : (item.title ?? labelText)}
              onClick={() => select(item.id)}
              onDoubleClick={(event) => {
                if (typeof item.onDoubleClick !== 'function') return
                if (event.target.closest('.tab-strip__close')) return
                event.preventDefault()
                item.onDoubleClick(item.id)
              }}
              onMouseDown={(event) => {
                if (event.button === 1) event.preventDefault()
              }}
              onAuxClick={(event) => {
                if (event.button !== 1 || !close) return
                event.preventDefault()
                close(item.id)
              }}
              onKeyDown={(event) => handleKeyDown(event, index)}
              onContextMenu={(event) => {
                if (!contextMenu) return
                contextMenu.open(event, { id: item.id })
              }}
            >
              {item.icon && <span className="tab-strip__icon" aria-hidden="true">{item.icon}</span>}
              {item.editing ? (
                <TabRenameInput
                  value={item.editValue ?? labelText ?? ''}
                  commit={item.onEditCommit}
                  cancel={item.onEditCancel}
                />
              ) : (
                <span className="tab-strip__label">{item.label}</span>
              )}
              {close ? (
                <button
                  type="button"
                  className="tab-strip__close"
                  tabIndex={-1}
                  aria-label={`Close ${typeof item.label === 'string' ? item.label : 'tab'}`}
                  onClick={(event) => {
                    event.stopPropagation()
                    close(item.id)
                  }}
                >
                  <span className="tab-strip__close-dot" aria-hidden="true" />
                  <span className="tab-strip__close-x" aria-hidden="true">×</span>
                </button>
              ) : (
                item.dirty && <span className="tab-strip__dirty" aria-hidden="true" />
              )}
            </div>
          </DevScope>
          </Fragment>
        )
      })}
    </div>
  )

  const node = closeAll ? (
    <div className={['tab-strip-bar', horizontal && 'tab-strip-bar--horizontal', className].filter(Boolean).join(' ')}>
      {strip}
      {items.length > 0 && (
        <DevScope id="q8n4wke" state={{ count: items.length }}>
          <button type="button" className="tab-strip__close-all" title="Close All Tabs" onClick={closeAll}>
            Close All
          </button>
        </DevScope>
      )}
    </div>
  ) : strip

  return devId ? <DevScope id={devId} state={{ activeId: activeId ?? null, count: items.length }}>{node}</DevScope> : node
}

export default TabStrip
