import { useCallback, useEffect, useRef, useState } from 'react'
import api from '../../api'

const OPEN = 1
const CLOSE_NOT_FOUND = 4404
const MIN_DELAY = 500
const MAX_DELAY = 10000

const backoff = (attempt) => Math.min(MIN_DELAY * 2 ** attempt, MAX_DELAY)

const useTerminalSocket = (id, termRef, onName) => {
  const [status, setStatus] = useState({ connected: false, exited: false, exitCode: null })
  const socketRef = useRef(null)
  const sizeRef = useRef(null)
  const onNameRef = useRef(onName)
  onNameRef.current = onName

  const sendMessage = (message) => {
    const socket = socketRef.current
    if (socket && socket.readyState === OPEN) socket.send(JSON.stringify(message))
  }

  useEffect(() => {
    if (!id) return undefined
    let disposed = false
    let done = false
    let attempt = 0
    let timer = 0
    setStatus({ connected: false, exited: false, exitCode: null })

    const connect = () => {
      const socket = new WebSocket(api.terminalSocketUrl(id))
      socketRef.current = socket

      socket.onopen = () => {
        attempt = 0
        termRef.current?.reset()
        setStatus((prev) => ({ ...prev, connected: true }))
        if (sizeRef.current) sendMessage({ type: 'resize', ...sizeRef.current })
      }

      socket.onmessage = (event) => {
        let message
        try {
          message = JSON.parse(event.data)
        } catch {
          return
        }
        if (message.type === 'output') termRef.current?.write(message.data)
        else if (message.type === 'name') onNameRef.current?.(id, message.name)
        else if (message.type === 'exit') {
          done = true
          setStatus((prev) => ({ ...prev, exited: true, exitCode: message.code ?? null }))
        }
      }

      socket.onclose = (event) => {
        if (socketRef.current === socket) socketRef.current = null
        if (disposed) return
        setStatus((prev) => ({ ...prev, connected: false }))
        if (event.code === CLOSE_NOT_FOUND) {
          done = true
          setStatus((prev) => ({ ...prev, exited: true }))
        }
        if (done) return
        timer = setTimeout(connect, backoff(attempt))
        attempt += 1
      }
    }

    connect()

    return () => {
      disposed = true
      clearTimeout(timer)
      const socket = socketRef.current
      socketRef.current = null
      socket?.close()
    }
  }, [id, termRef])

  const input = useCallback((data) => sendMessage({ type: 'input', data }), [])

  const resize = useCallback(({ cols, rows }) => {
    sizeRef.current = { cols, rows }
    sendMessage({ type: 'resize', cols, rows })
  }, [])

  return { ...status, input, resize }
}

export default useTerminalSocket
