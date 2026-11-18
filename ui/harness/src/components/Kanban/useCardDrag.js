import { useRef, useState } from 'react'

const isControl = (target) => {
  const control = target.closest('button, a, input, select, textarea, label, [role="button"], [contenteditable="true"]')
  return control && !control.classList.contains('kanban__card-content')
}

const useCardDrag = (busy, onEnd) => {
  const [dragged, setDragged] = useState(null)
  const dragRef = useRef(null)
  const blocked = useRef(false)
  const suppressClick = useRef(false)
  const clearDrag = () => {
    dragRef.current = null
    setDragged(null)
    onEnd()
  }
  const getDragProps = (card) => {
    return {
      draggable: !busy,
      onPointerDownCapture: (event) => {
        blocked.current = isControl(event.target)
        suppressClick.current = false
      },
      onKeyDownCapture: (event) => {
        if (event.key === 'Enter' || event.key === ' ') suppressClick.current = false
      },
      onClickCapture: (event) => {
        if (!suppressClick.current) return
        event.preventDefault()
        event.stopPropagation()
      },
      onDragStart: (event) => {
        event.stopPropagation()
        if (busy || blocked.current || isControl(event.target)) {
          event.preventDefault()
          return
        }
        dragRef.current = card
        setDragged(card)
        suppressClick.current = true
        event.dataTransfer.effectAllowed = 'move'
        event.dataTransfer.setData('text/plain', card.id)
        const bounds = event.currentTarget.getBoundingClientRect()
        event.dataTransfer.setDragImage(event.currentTarget, event.clientX - bounds.left, event.clientY - bounds.top)
      },
      onDragEnd: clearDrag
    }
  }
  return { dragged, dragRef, clearDrag, getDragProps }
}

export default useCardDrag
