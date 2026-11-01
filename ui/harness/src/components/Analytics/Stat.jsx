import { CardLabel, CardSection } from 'component-library'

const Stat = ({ label, value, sub }) => (
  <CardSection>
    <CardLabel>{label}</CardLabel>
    <div className="analytics__stat-val">{value}</div>
    {sub && <div className="analytics__stat-sub">{sub}</div>}
  </CardSection>
)

export default Stat
