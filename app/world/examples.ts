/**
 * Canned op batches for the dev console: the plan's worked examples plus a few that exercise each
 * arrangement. Each stands in for one sentence the model would get in Sprint 2.
 */
export interface Example {
  id: string
  chip: string // short button text
  label: string // the sentence it stands for
  ops: unknown[]
}

const CLOCK_PARTS = [
  { shape: 'box', size: [0.62, 2.0, 0.42], at: [0, 1.0, 0], color: '#5a3a22', slot: 'primary', material: 'wood' },
  { shape: 'box', size: [0.74, 0.12, 0.5], at: [0, 0.06, 0], color: '#3e2716', slot: 'trim', material: 'wood' },
  { shape: 'box', size: [0.74, 0.14, 0.5], at: [0, 2.07, 0], color: '#3e2716', slot: 'trim', material: 'wood' },
  { shape: 'cone', size: [0.5, 0.22, 0.36], at: [0, 2.25, 0], color: '#3e2716', slot: 'trim', material: 'wood' },
  { shape: 'cylinder', size: [0.42, 0.04, 0.42], at: [0, 1.62, 0.22], rot: [1.571, 0, 0], color: '#f2ead8' },
  { shape: 'box', size: [0.03, 0.15, 0.02], at: [0, 1.67, 0.245], color: '#1d1d1d' },
  { shape: 'box', size: [0.11, 0.03, 0.02], at: [0.04, 1.62, 0.245], color: '#1d1d1d' },
  { shape: 'box', size: [0.34, 0.8, 0.02], at: [0, 0.95, 0.215], color: '#2b1c10', material: 'glass' },
  { shape: 'cylinder', size: [0.02, 0.5, 0.02], at: [0, 1.05, 0.23], color: '#c9a34a', material: 'metal' },
  { shape: 'cylinder', size: [0.2, 0.03, 0.2], at: [0, 0.78, 0.235], rot: [1.571, 0, 0], color: '#e0b84f', slot: 'glow' }
]

export const EXAMPLES: Example[] = [
  {
    id: 'house',
    chip: 'house',
    label: 'Put a little house over there',
    ops: [{ op: 'spawn', kind: 'house', at: { anchor: 'gaze' }, facing: 'player' }, { op: 'say', text: 'There you go.' }]
  },
  {
    id: 'trees',
    chip: 'trees ×9',
    label: 'Make a bunch of trees',
    ops: [{ op: 'spawn', kind: 'pine', count: 9, arrange: 'cluster', at: { anchor: 'gaze' }, radius: 6, vary: 0.35 }]
  },
  {
    id: 'oaks',
    chip: 'oaks',
    label: 'Some oaks off to the right',
    ops: [{ op: 'spawn', kind: 'oak', count: 4, arrange: 'cluster', at: { anchor: 'player', dir: 'right', dist: 14 }, vary: 0.3 }]
  },
  {
    id: 'trees-red',
    chip: 'trees red',
    label: 'Make all the trees red',
    ops: [{ op: 'modify', target: { tag: 'tree' }, set: { color: '#c0453a' } }, { op: 'say', text: 'Autumn, early.' }]
  },
  {
    id: 'houses',
    chip: 'houses',
    label: 'A few houses over there',
    ops: [{ op: 'spawn', kind: 'house', count: 4, arrange: 'cluster', at: { anchor: 'gaze' }, vary: 0.2, set: { color: '#cfd8e3' } }]
  },
  {
    id: 'houses-tall',
    chip: '2× taller',
    label: 'Make those houses twice as tall',
    ops: [{ op: 'modify', target: { tag: 'house', near: 'gaze', within: 15 }, set: { height: 2 }, relative: true }]
  },
  {
    id: 'floor',
    chip: '+1 floor',
    label: 'Give it another floor',
    ops: [{ op: 'modify', target: { ref: 'gaze', tag: 'building' }, set: { floors: 2 } }]
  },
  {
    id: 'clock',
    chip: 'clock (define)',
    label: 'Put a grandfather clock there',
    ops: [
      { op: 'define', kind: 'grandfather_clock', tags: ['clock', 'furniture'], parts: CLOCK_PARTS },
      { op: 'spawn', kind: 'grandfather_clock', at: { anchor: 'gaze' }, facing: 'player' },
      { op: 'say', text: 'Tick, tock.' }
    ]
  },
  {
    id: 'five-more',
    chip: '5 more',
    label: 'Five more of those',
    ops: [{ op: 'spawn', kind: 'grandfather_clock', count: 5, arrange: 'line', at: { anchor: 'target', of: { ref: 'last' }, side: 'right', gap: 0.6 } }]
  },
  {
    id: 'road',
    chip: 'road + lamps',
    label: 'A road with lamps along it',
    ops: [
      { op: 'spawn', kind: 'road', at: { anchor: 'gaze' }, facing: 'player' },
      { op: 'spawn', kind: 'lamp', count: 8, arrange: 'along', at: { anchor: 'target', of: { kind: 'road' } } }
    ]
  },
  {
    id: 'ring',
    chip: 'rock ring',
    label: 'A ring of rocks around me',
    ops: [{ op: 'spawn', kind: 'rock', count: 10, arrange: 'ring', at: { anchor: 'player', dist: 0 }, radius: 6, vary: 0.4 }]
  },
  {
    id: 'cafe',
    chip: 'table + chairs',
    label: 'A table with chairs around it',
    ops: [
      { op: 'spawn', kind: 'table', at: { anchor: 'gaze' }, facing: 'player' },
      { op: 'spawn', kind: 'chair', count: 4, arrange: 'ring', at: { anchor: 'target', of: { kind: 'table', near: 'gaze', sort: 'distance', limit: 1 }, side: 'around', gap: 0.05 }, facing: 'center' }
    ]
  },
  {
    id: 'mystery',
    chip: 'pinball?',
    label: 'A pinball machine (unknown kind)',
    ops: [{ op: 'spawn', kind: 'pinball_machine', at: { anchor: 'gaze' } }]
  },
  {
    id: 'remove',
    chip: 'remove',
    label: 'Get rid of that',
    ops: [{ op: 'remove', target: { ref: 'gaze' } }, { op: 'say', text: 'Gone.' }]
  },
  {
    id: 'bad',
    chip: 'bad op',
    label: 'One bad op among good ones',
    ops: [{ op: 'spawn' }, { op: 'spawn', kind: 'bench', at: { anchor: 'gaze' } }, { op: 'paint', color: 'red' }]
  },
  { id: 'night', chip: 'night', label: 'Make it night', ops: [{ op: 'atmosphere', time: 'night' }] },
  { id: 'golden', chip: 'golden', label: 'Golden hour', ops: [{ op: 'atmosphere', time: 'golden', fog: 0.5 }] },
  { id: 'day', chip: 'day', label: 'Daytime', ops: [{ op: 'atmosphere', time: 'day' }] },
  { id: 'dusk', chip: 'dusk', label: 'Back to dusk', ops: [{ op: 'atmosphere', time: 'dusk' }] },
  { id: 'undo', chip: 'undo', label: 'Undo that', ops: [{ op: 'undo' }] }
]
