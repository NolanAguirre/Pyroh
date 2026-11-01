import {
  Badge,
  DevScope,
  SplitPane,
  Tab,
  TabList,
  TabsDisplay,
} from 'component-library'

export const MOBILE_SESSIONS = 0
export const MOBILE_CHAT = 1
export const MOBILE_JOBS = 2

const mobilePaneClass = (pane, current) => `app__mobile-pane${current === pane ? '' : ' app__mobile-pane--hidden'}`

export const MobileLayout = ({ pane, onPane, sidebar, main, jobs, runningCount }) => (
  <DevScope id="m4q8z2t" state={{ pane }}>
    <div className="app app--mobile">
      <div className={mobilePaneClass(MOBILE_SESSIONS, pane)}>
        {sidebar}
      </div>
      <div className={mobilePaneClass(MOBILE_CHAT, pane)}>
        {main}
      </div>
      <div className={mobilePaneClass(MOBILE_JOBS, pane)}>
        {jobs}
      </div>
      <nav className="app__mobile-nav">
        <TabsDisplay index={pane} select={onPane}>
          <TabList>
            <Tab>Sessions</Tab>
            <Tab>Chat</Tab>
            <Tab>
              Jobs
              {runningCount > 0 && <Badge size="small" variant="info" count={runningCount} />}
            </Tab>
          </TabList>
        </TabsDisplay>
      </nav>
    </div>
  </DevScope>
)

export const DesktopLayout = ({ sidebar, main, jobs, jobsCollapsed }) => (
  <div className="app">
    <SplitPane
      direction="horizontal"
      defaultSize={320}
      minSize={260}
      maxSize={500}
      storageKey="harness.sidebar.width"
      devId="w1n6c4y"
    >
      {sidebar}
      <div className="app__content">
        <SplitPane
          className="app__jobs-split"
          direction="horizontal"
          primary="second"
          defaultSize={280}
          minSize={200}
          maxSize={520}
          fixedSize={jobsCollapsed ? 38 : null}
          storageKey="harness.jobs.width"
          devId="hr8j5p1"
        >
          {main}
          {jobs}
        </SplitPane>
      </div>
    </SplitPane>
  </div>
)
