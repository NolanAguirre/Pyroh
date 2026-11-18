import { useRef } from 'react'
import { Button } from 'component-library'
import api from '../../api'
import NewSessionForm from '../NewSessionForm'

export const SpawnAgentButton = ({ card, busy, onSpawn }) => {
  return <Button type="button" variant="ghost" size="sm" disabled={busy} aria-label={`Spawn agent for ${card.title}`} onClick={() => onSpawn(card)}>Spawn agent</Button>
}

const CardAgentForm = ({ card, workspace, providers, onStarted, onCreated, onBusyChange, popup }) => {
  const started = useRef(false)
  const afterCreate = async (session) => {
    if (!started.current) {
      try {
        await api.run(session.id, { prompt: card.description, mode: 'agent' })
        started.current = true
      } catch (error) {
        throw new Error(`The agent could not be started: ${error.message}`)
      }
    }
    try {
      await onStarted(card)
    } catch (error) {
      throw new Error(`The agent started, but the card status could not be updated: ${error.message}. Retry only updates the card.`)
    }
  }

  return <div role="dialog" aria-modal="true" aria-label={`Spawn agent for ${card.title}`}>
    <p>{card.title}</p>
    <NewSessionForm devId="kbspawnform" workspace={workspace} providers={providers} title="Spawn agent" submitLabel="Spawn agent" afterCreate={afterCreate} reuseSessionOnRetry onBusyChange={onBusyChange} onCreated={onCreated} popup={popup} />
  </div>
}

export default CardAgentForm
