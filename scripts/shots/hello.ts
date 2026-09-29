import type { ShotList } from '../shot-types'

const list: ShotList = {
  feature: 'hello',
  shots: [{ name: 'home', path: '/', waitFor: 'main' }],
}

export default list
