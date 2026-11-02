import {
  type Edge,
  type EdgeProps,
  EdgeLabelRenderer,
  Handle,
  MarkerType,
  type Node,
  type NodeProps,
  applyNodeChanges,
  type NodeChange,
  Position,
  ReactFlow,
  ViewportPortal,
} from '@xyflow/react'
import { type KeyboardEvent, useState } from 'react'
import { strings } from '../strings'
import type { CardRelation, CharacterCard } from '../types'
import { Portrait } from './CharacterCard'
import {
  GROUP_PAD,
  type Group,
  hullOf,
  layout,
  type LineStyle,
  pairsOf,
  type RelationKind,
  styleOf,
} from './relationLayout'

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
function Legend({ factions }: { factions: boolean }) {
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
      {factions && (
        <div className="graph-legend-row">
          <dt>
            <svg width="30" height="14" aria-hidden="true">
              <rect x="1" y="1" width="28" height="12" rx="6" className="faction-shape" />
            </svg>
          </dt>
          <dd>{strings.dex.faction}</dd>
        </div>
      )}
    </dl>
  )
}

type FactionNode = Node<{ name: string; path: string; label: { x: number; y: number } }, 'faction'>
type GraphNode = CharacterNode | FactionNode

/** A faction's area: a dashed outline round its members, under the lines (its name is drawn
 * over them: FactionNames). */
function FactionNodeView({ data, width, height }: NodeProps<FactionNode>) {
  return (
    <svg className="faction-area" width={width} height={height} aria-hidden="true">
      <path d={data.path} className="faction-shape" />
    </svg>
  )
}

/** Each faction's name on a paper tab at the top of its outline, over the lines. */
function FactionNames({ nodes }: { nodes: GraphNode[] }) {
  return (
    <ViewportPortal>
      {nodes.map((node) =>
        node.type === 'faction' ? (
          <div
            key={node.id}
            className="faction-name"
            style={{
              transform: `translate(-50%, -50%) translate(${String(node.data.label.x)}px, ${String(node.data.label.y)}px)`,
            }}
          >
            {node.data.name}
          </div>
        ) : null,
      )}
    </ViewportPortal>
  )
}

/** Each faction's area node from where its members are now (redone as they are dragged).
 * Areas lie under the lines, overlapping where a character is in more than one. */
function withAreas(nodes: GraphNode[], groups: Group[]): GraphNode[] {
  const characters = nodes.filter((node) => node.type === 'character')
  const at = new Map(characters.map((node) => [node.id, node.position]))
  const areas: FactionNode[] = groups.flatMap((group) => {
    const points = group.members.flatMap((id) => at.get(id) ?? [])
    if (points.length < 2) return []
    const hull = hullOf(points, GROUP_PAD)
    const left = Math.min(...hull.map((point) => point.x))
    const top = Math.min(...hull.map((point) => point.y))
    const right = Math.max(...hull.map((point) => point.x))
    const bottom = Math.max(...hull.map((point) => point.y))
    const topmost = hull.reduce((best, point) => (point.y < best.y ? point : best))
    const path = `M ${hull.map((point) => `${String(point.x - left)} ${String(point.y - top)}`).join(' L ')} Z`
    return [
      {
        id: `faction:${group.id}`,
        type: 'faction',
        position: { x: left, y: top },
        width: right - left,
        height: bottom - top,
        zIndex: -1,
        draggable: false,
        selectable: false,
        focusable: false,
        data: {
          name: group.name,
          path,
          label: { x: topmost.x, y: topmost.y },
        },
      },
    ]
  })
  return [...areas, ...characters]
}

const NODE_TYPES = { character: CharacterNodeView, faction: FactionNodeView }
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

function graphOf(cards: CharacterCard[], relations: CardRelation[], groups: Group[]) {
  const pairs = pairsOf(relations, new Set(cards.map((card) => card.id)))
  const points = layout(
    cards.map((card) => card.id),
    pairs,
    groups,
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
  return { nodes: withAreas(nodes, groups), edges }
}

type Props = {
  cards: CharacterCard[]
  relations: CardRelation[]
  /** Factions with their members among the cards: drawn as areas, members kept together. */
  groups: Group[]
  /** A node was clicked (or Enter pressed on it): open its card from where it sits. */
  onPick: (cardId: string, origin: DOMRect | null) => void
}

/** 관계도 (§8): a node per character, a line per related pair coloured by what the relations
 * say (solid when both sides feel it, dashed when one does), each faction's members together
 * inside its area, with a key at the top left. Laid out afresh each time it mounts (the
 * screen remounts it when cards, relations or factions change), never per render; dragging
 * moves a node for this view only, its areas following. */
export function RelationGraph({ cards, relations, groups, onPick }: Props) {
  const [graph] = useState(() => graphOf(cards, relations, groups))
  const [nodes, setNodes] = useState<GraphNode[]>(graph.nodes)
  const { edges } = graph
  const onNodesChange = (changes: NodeChange<GraphNode>[]) => {
    setNodes((current) => withAreas(applyNodeChanges(changes, current), groups))
  }

  const nodeElement = (target: EventTarget) =>
    target instanceof Element ? target.closest<HTMLElement>('.react-flow__node') : null

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'Enter' && event.key !== ' ') return
    const node = nodeElement(event.target)
    const id = node?.dataset.id
    if (!node || !id || id.startsWith('faction:')) return
    event.preventDefault()
    onPick(id, node.getBoundingClientRect())
  }

  return (
    <div className="dex-graph" onKeyDown={onKeyDown}>
      <Legend factions={groups.length > 0} />
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={NODE_TYPES}
        edgeTypes={EDGE_TYPES}
        onNodesChange={onNodesChange}
        onNodeClick={(event, node) => {
          if (node.type !== 'character') return
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
      >
        <FactionNames nodes={nodes} />
      </ReactFlow>
    </div>
  )
}
