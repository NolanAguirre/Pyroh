import { Button, Tabs, TabList, Tab, TabPanel } from 'component-library'
import MetricsPanel from '../MetricsPanel'
import LogFold from '../LogFold'
import DecomposeProgress from './DecomposeProgress'

const SessionInspector = ({ sessionId, session, runs, status, isBusy, hasFailure, refreshKey, sideOpen, setSideOpen }) => (
<aside className={`session-view__side${sideOpen ? '' : ' session-view__side--collapsed'}`}>
  {sideOpen ? (
    <>
      <DecomposeProgress session={session} />
      <Tabs defaultIndex={0}>
        <TabList>
          <Tab>Metrics</Tab>
          <Tab>Daemon Log</Tab>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setSideOpen(false)}
            devId="hr4c8w2"
            title="Collapse inspector"
            aria-label="Collapse inspector"
          >
            →
          </Button>
        </TabList>
        <TabPanel panelIndex={0}>
          <MetricsPanel devId="hr0s6k9" session={session} runs={runs} />
        </TabPanel>
        <TabPanel panelIndex={1}>
          <LogFold
            devId="hr4j2p8"
            sessionId={sessionId}
            logPath={session.logPath}
            refreshKey={`${status}:${latestRun?.id}:${latestRun?.endedAt}:${events.length}`}
            active={isBusy}
            hasFailure={hasFailure}
          />
        </TabPanel>
      </Tabs>
    </>
  ) : (
    <button
      type="button"
      className="session-view__side-collapsed-btn"
      onClick={() => setSideOpen(true)}
      title="Expand inspector"
      aria-label="Expand inspector"
    >
      <span className="session-view__side-collapsed-text">Metrics</span>
    </button>
  )}
</aside>
)

export default SessionInspector
