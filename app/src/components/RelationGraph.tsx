import {
  BaseEdge,
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
import type { KeyboardEvent } from 'react'
import { strings } from '../strings'
import type { CardRelation, CharacterCard } from '../types'
import { Portrait } from './CharacterCard'
import { layout, pairsOf } from './relationLayout'

type CharacterNode = Node<{ card: CharacterCard }, 'character'>
type RelationEdge = Edge<{ ab: string | null; ba: string | null }, 'relation'>

// The portrait is a 72px disc; lines stop just outside it so the arrowheads show.
const RADIUS = 42
// A label sits this far from its own node's centre, clear of the disc and the name.
const LABEL_AT = 96

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
  const from = { x: sourceX + ux * RADIUS, y: sourceY + uy * RADIUS }
  const to = { x: targetX - ux * RADIUS, y: targetY - uy * RADIUS }
  // Each relation sits at its own end: a's view of b near a, b's view of a near b (on a
  // short line both move in towards the middle).
  const off = Math.min(LABEL_AT, length * 0.35)
  const labels = [
    { text: data?.ab, point: { x: sourceX + ux * off, y: sourceY + uy * off }, side: 'a' },
    { text: data?.ba, point: { x: targetX - ux * off, y: targetY - uy * off }, side: 'b' },
  ]
  return (
    <>
      <BaseEdge
        id={id}
        path={`M ${String(from.x)} ${String(from.y)} L ${String(to.x)} ${String(to.y)}`}
        markerStart={markerStart}
        markerEnd={markerEnd}
        className="graph-line"
      />
      <EdgeLabelRenderer>
        {labels.map(({ text, point, side }) =>
          text ? (
            <div
              key={side}
              className="graph-label"
              style={{
                transform: `translate(-50%, -50%) translate(${String(point.x)}px, ${String(point.y)}px)`,
              }}
            >
              {text}
            </div>
          ) : null,
        )}
      </EdgeLabelRenderer>
    </>
  )
}

const NODE_TYPES = { character: CharacterNodeView }
const EDGE_TYPES = { relation: RelationEdgeView }
const ARROW = { type: MarkerType.ArrowClosed, width: 18, height: 18 } as const

type Props = {
  cards: CharacterCard[]
  relations: CardRelation[]
  /** A node was clicked (or Enter pressed on it): open its card from where it sits. */
  onPick: (cardId: string, origin: DOMRect | null) => void
}

/** 관계도 (§8): a node per character, a line per related pair with each side's relation at
 * its own end. Laid out afresh each time; dragging moves a node for this view only. */
export function RelationGraph({ cards, relations, onPick }: Props) {
  const pairs = pairsOf(relations, new Set(cards.map((card) => card.id)))
  const points = layout(
    cards.map((card) => card.id),
    pairs,
  )
  const [nodes, , onNodesChange] = useNodesState<CharacterNode>(
    cards.map((card) => ({
      id: card.id,
      type: 'character',
      position: points.get(card.id) ?? { x: 0, y: 0 },
      origin: [0.5, 0.36],
      data: { card },
      ariaLabel: strings.dex.flip(card.name ?? strings.drawer.untitled),
    })),
  )
  const edges: RelationEdge[] = pairs.map((pair) => ({
    id: pair.id,
    type: 'relation',
    source: pair.a,
    target: pair.b,
    data: { ab: pair.ab, ba: pair.ba },
    markerEnd: pair.ab !== null ? ARROW : undefined,
    markerStart: pair.ba !== null ? ARROW : undefined,
  }))

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
      />
    </div>
  )
}
