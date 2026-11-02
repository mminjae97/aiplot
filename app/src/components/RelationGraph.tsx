import {
  type Edge,
  type EdgeProps,
  EdgeLabelRenderer,
  Handle,
  MarkerType,
  type Node,
  type NodeProps,
  Position,
  ReactFlow,
  useNodesState,
} from '@xyflow/react'
import { type KeyboardEvent, useState } from 'react'
import { strings } from '../strings'
import type { CardRelation, CharacterCard } from '../types'
import { Portrait } from './CharacterCard'
import { layout, type LineStyle, pairsOf, type RelationKind, styleOf } from './relationLayout'

type CharacterNode = Node<{ card: CharacterCard }, 'character'>
type RelationEdge = Edge<{ style: LineStyle; title: string }, 'relation'>

// The portrait is a 72px disc; lines stop just outside it so the arrowheads show.
const RADIUS = 42
// How far a line bows out, as a share of its length, and at most (px).
const BEND = 0.08
const BEND_MAX = 28

/** A shape for each kind beside its colour, so colour is never the only sign (§5). */
const GLYPHS: Record<RelationKind, string> = {
  love: '♥',
  friendly: '●',
  hostile: '✕',
  neutral: '◆',
}
const KINDS: RelationKind[] = ['love', 'friendly', 'hostile', 'neutral']
const colorOf = (kind: RelationKind) => `var(--rel-${kind})`

function CharacterNodeView({ data }: NodeProps<CharacterNode>) {
  return (
    <div className="graph-node">
      <Handle
        type="target"
        position={Position.Top}
        className="graph-handle"
        isConnectable={false}
      />
      <Handle
        type="source"
        position={Position.Top}
        className="graph-handle"
        isConnectable={false}
      />
      <div className="graph-portrait">
        <Portrait card={data.card} />
      </div>
      <span className="graph-name">{data.card.name ?? strings.drawer.untitled}</span>
    </div>
  )
}

function RelationEdgeView({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  data,
  markerStart,
  markerEnd,
}: EdgeProps<RelationEdge>) {
  const dx = targetX - sourceX
  const dy = targetY - sourceY
  const length = Math.hypot(dx, dy) || 1
  const ux = dx / length
  const uy = dy / length
  // Discs dragged onto each other: no line (its ends would cross and flip the arrows).
  if (length <= 2 * RADIUS || !data) return null
  // A gentle bow, always to the same side of a→b, so lines running the same way part.
  const bend = Math.min(BEND_MAX, length * BEND)
  const control = {
    x: (sourceX + targetX) / 2 - uy * bend,
    y: (sourceY + targetY) / 2 + ux * bend,
  }
  // Each end leaves its disc toward the bow's control point.
  const towards = (from: { x: number; y: number }) => {
    const cx = control.x - from.x
    const cy = control.y - from.y
    const reach = Math.hypot(cx, cy) || 1
    return { x: from.x + (cx / reach) * RADIUS, y: from.y + (cy / reach) * RADIUS }
  }
  const from = towards({ x: sourceX, y: sourceY })
  const to = towards({ x: targetX, y: targetY })
  const path = `M ${String(from.x)} ${String(from.y)} Q ${String(control.x)} ${String(control.y)} ${String(to.x)} ${String(to.y)}`
  const { kind, mutual } = data.style
  const middle = {
    x: 0.25 * from.x + 0.5 * control.x + 0.25 * to.x,
    y: 0.25 * from.y + 0.5 * control.y + 0.25 * to.y,
  }
  return (
    <>
      <path
        id={id}
        d={path}
        className="graph-line"
        data-kind={kind}
        data-mutual={mutual || undefined}
        markerStart={markerStart}
        markerEnd={markerEnd}
      />
      {/* What each side says shows on hover; the line itself carries no words. */}
      <path d={path} className="graph-line-hit">
        <title>{data.title}</title>
      </path>
      <EdgeLabelRenderer>
        <div
          className="graph-glyph"
          aria-hidden="true"
          style={{
            color: colorOf(kind),
            transform: `translate(-50%, -50%) translate(${String(middle.x)}px, ${String(middle.y)}px)`,
          }}
        >
          {GLYPHS[kind]}
        </div>
      </EdgeLabelRenderer>
    </>
  )
}

function LineSample({ kind, mutual }: { kind?: RelationKind; mutual: boolean }) {
  return (
    <svg width="30" height="10" aria-hidden="true">
      <line
        x1="1"
        y1="5"
        x2={mutual ? 29 : 23}
        y2="5"
        className="graph-line"
        data-kind={kind}
        data-mutual={mutual || undefined}
      />
      {!mutual && <path d="M 22 1 L 30 5 L 22 9 z" className="graph-legend-head" />}
    </svg>
  )
}

/** The key at the top left: each kind's colour and shape, then solid (both sides feel it)
 * and dashed (one side does). */
function Legend() {
  return (
    <dl className="graph-legend" aria-label={strings.dex.legend}>
      {KINDS.map((kind) => (
        <div key={kind} className="graph-legend-row">
          <dt>
            <LineSample kind={kind} mutual />
            <span className="graph-legend-glyph" style={{ color: colorOf(kind) }}>
              {GLYPHS[kind]}
            </span>
          </dt>
          <dd>{strings.dex.kinds[kind]}</dd>
        </div>
      ))}
      <div className="graph-legend-row">
        <dt>
          <LineSample mutual />
        </dt>
        <dd>{strings.dex.mutual}</dd>
      </div>
      <div className="graph-legend-row">
        <dt>
          <LineSample mutual={false} />
        </dt>
        <dd>{strings.dex.oneWay}</dd>
      </div>
    </dl>
  )
}

const NODE_TYPES = { character: CharacterNodeView }
const EDGE_TYPES = { relation: RelationEdgeView }
// In the line's colour (React Flow writes the marker colour inline).
const arrowOf = (kind: RelationKind) =>
  ({ type: MarkerType.ArrowClosed, width: 18, height: 18, color: colorOf(kind) }) as const

// React Flow's screen-reader text, in Korean; nodes open a card, nothing is selected.
const ARIA = {
  'node.a11yDescription.default': 'Enter 키로 카드를 뒤집어 봐요.',
  'node.a11yDescription.keyboardDisabled': 'Enter 키로 카드를 뒤집어 봐요.',
  'edge.a11yDescription.default': '두 인물의 관계예요.',
}

function graphOf(cards: CharacterCard[], relations: CardRelation[]) {
  const pairs = pairsOf(relations, new Set(cards.map((card) => card.id)))
  const points = layout(
    cards.map((card) => card.id),
    pairs,
  )
  const nodes: CharacterNode[] = cards.map((card) => ({
    id: card.id,
    type: 'character',
    position: points.get(card.id) ?? { x: 0, y: 0 },
    origin: [0.5, 0.36],
    data: { card },
    ariaLabel: strings.dex.flip(card.name ?? strings.drawer.untitled),
  }))
  const names = new Map(cards.map((card) => [card.id, card.name ?? strings.drawer.untitled]))
  const edges: RelationEdge[] = pairs.map((pair) => {
    const style = styleOf(pair)
    const a = names.get(pair.a) ?? ''
    const b = names.get(pair.b) ?? ''
    const title = [
      pair.ab === null ? null : strings.dex.relationOf(a, b, pair.ab),
      pair.ba === null ? null : strings.dex.relationOf(b, a, pair.ba),
    ]
      .filter((line) => line !== null)
      .join('\n')
    return {
      id: pair.id,
      type: 'relation',
      source: pair.a,
      target: pair.b,
      data: { style, title },
      ariaLabel: title,
      // A solid line is both ways and has no arrowheads; a dashed one points from the side
      // that feels it.
      markerEnd: !style.mutual && style.fromA ? arrowOf(style.kind) : undefined,
      markerStart: !style.mutual && style.fromB ? arrowOf(style.kind) : undefined,
    }
  })
  return { nodes, edges }
}

type Props = {
  cards: CharacterCard[]
  relations: CardRelation[]
  /** A node was clicked (or Enter pressed on it): open its card from where it sits. */
  onPick: (cardId: string, origin: DOMRect | null) => void
}

/** 관계도 (§8): a node per character, a line per related pair coloured by what the relations
 * say (solid when both sides feel it, dashed when one does), with a key at the top left. Laid out afresh each time it mounts (the screen remounts it when cards or
 * relations change), never per render; dragging moves a node for this view only. */
export function RelationGraph({ cards, relations, onPick }: Props) {
  const [graph] = useState(() => graphOf(cards, relations))
  const [nodes, , onNodesChange] = useNodesState<CharacterNode>(graph.nodes)
  const { edges } = graph

  const nodeElement = (target: EventTarget) =>
    target instanceof Element ? target.closest<HTMLElement>('.react-flow__node') : null

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'Enter' && event.key !== ' ') return
    const node = nodeElement(event.target)
    const id = node?.dataset.id
    if (!node || !id) return
    event.preventDefault()
    onPick(id, node.getBoundingClientRect())
  }

  return (
    <div className="dex-graph" onKeyDown={onKeyDown}>
      <Legend />
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={NODE_TYPES}
        edgeTypes={EDGE_TYPES}
        onNodesChange={onNodesChange}
        onNodeClick={(event, node) => {
          onPick(node.id, nodeElement(event.target)?.getBoundingClientRect() ?? null)
        }}
        nodesConnectable={false}
        elementsSelectable={false}
        fitView
        fitViewOptions={{ padding: 0.2, maxZoom: 1.2 }}
        minZoom={0.3}
        maxZoom={2}
        proOptions={{ hideAttribution: true }}
        ariaLabelConfig={ARIA}
      />
    </div>
  )
}
