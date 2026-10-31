import {
  applyNodeChanges,
  BaseEdge,
  type Edge,
  type EdgeProps,
  EdgeLabelRenderer,
  Handle,
  type Node,
  type NodeChange,
  type NodeProps,
  Position,
  ReactFlow,
  type ReactFlowInstance,
} from '@xyflow/react'
import { type KeyboardEvent, type MouseEvent, useRef, useState } from 'react'
import { strings } from '../strings'
import type { CardRelation, RegionCard, RegionLinkRow } from '../types'
import {
  areasOf,
  layout,
  linesOf,
  NODE_HEIGHT,
  NODE_WIDTH,
  type Point,
  travelText,
} from './regionLayout'

type RegionData = { card: RegionCard; episodes: string[] }
type RegionNode = Node<RegionData, 'region'>
type AreaNode = Node<
  { card: RegionCard; onPick: (id: string, origin: DOMRect | null) => void },
  'area'
>
type MapNode = RegionNode | AreaNode
type JourneyEdge = Edge<{ label: string | null }, 'journey'>

const reducedMotion = () =>
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches

function Centre() {
  // Lines meet at the centre of a token or an area.
  return (
    <>
      <Handle type="target" position={Position.Top} className="map-handle" isConnectable={false} />
      <Handle type="source" position={Position.Top} className="map-handle" isConnectable={false} />
    </>
  )
}

function RegionNodeView({ data }: NodeProps<RegionNode>) {
  const count = data.episodes.length
  return (
    <div className="map-node" data-incomplete={data.card.status === 'incomplete' || undefined}>
      <Centre />
      <span className="map-node-name">{data.card.name ?? strings.drawer.untitled}</span>
      {count > 0 && (
        <span className="map-badge" aria-label={strings.map.episodes(count)}>
          {count}
          <span className="map-episodes" aria-hidden="true">
            {data.episodes.map((name, index) => (
              <span key={index}>{name}</span>
            ))}
          </span>
        </span>
      )}
    </div>
  )
}

function AreaNodeView({ data }: NodeProps<AreaNode>) {
  return (
    <div className="map-area">
      <Centre />
      <button
        type="button"
        className="map-area-name nodrag nopan"
        aria-label={strings.map.open(data.card.name ?? strings.drawer.untitled)}
        onClick={(event) => {
          data.onPick(data.card.id, event.currentTarget.getBoundingClientRect())
        }}
      >
        {data.card.name ?? strings.drawer.untitled}
      </button>
    </div>
  )
}

function JourneyEdgeView({ id, sourceX, sourceY, targetX, targetY, data }: EdgeProps<JourneyEdge>) {
  const midX = (sourceX + targetX) / 2
  const midY = (sourceY + targetY) / 2
  return (
    <>
      <BaseEdge
        id={id}
        path={`M ${String(sourceX)} ${String(sourceY)} L ${String(targetX)} ${String(targetY)}`}
        className="map-line"
      />
      {data?.label && (
        <EdgeLabelRenderer>
          <div
            className="map-line-label"
            style={{
              transform: `translate(-50%, -50%) translate(${String(midX)}px, ${String(midY)}px)`,
            }}
          >
            {data.label}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  )
}

const NODE_TYPES = { region: RegionNodeView, area: AreaNodeView }
const EDGE_TYPES = { journey: JourneyEdgeView }

type Props = {
  cards: RegionCard[]
  links: RegionLinkRow[]
  parents: CardRelation[]
  /** Region id -> names of the episodes set there. */
  episodes: ReadonlyMap<string, string[]>
  locked: boolean
  onPick: (cardId: string, origin: DOMRect | null) => void
  /** A region was dragged here (flow coordinates of its centre). */
  onMove: (cardId: string, at: Point) => void
}

/** Region id -> its children among the drawn regions. */
function childrenOf(cards: RegionCard[], parents: CardRelation[]) {
  const drawn = new Set(cards.map((card) => card.id))
  const children = new Map<string, string[]>()
  for (const row of parents) {
    if (row.from_id === row.to_id || !drawn.has(row.from_id) || !drawn.has(row.to_id)) continue
    children.set(row.to_id, [...(children.get(row.to_id) ?? []), row.from_id])
  }
  return children
}

/** Recomputes the areas around the tokens where they now stand. */
function withAreas(nodes: MapNode[], children: ReadonlyMap<string, string[]>): MapNode[] {
  const points = new Map(
    nodes.filter((node) => node.type === 'region').map((node) => [node.id, node.position]),
  )
  const boxes = areasOf(children, points)
  return nodes.map((node) => {
    if (node.type !== 'area') return node
    const box = boxes.get(node.id)
    if (!box) return node
    return { ...node, position: { x: box.x, y: box.y }, width: box.width, height: box.height }
  })
}

/** The region map (§8 S1-2): a token per region, a line per linked pair labelled with the
 * journey, parents as dashed areas. Laid out once per mount around the saved positions. */
export function RegionMap({ cards, links, parents, episodes, locked, onPick, onMove }: Props) {
  const flow = useRef<ReactFlowInstance<MapNode, JourneyEdge> | null>(null)
  const [children] = useState(() => childrenOf(cards, parents))
  const [edges] = useState<JourneyEdge[]>(() =>
    linesOf(links, new Set(cards.map((card) => card.id))).map((line) => ({
      id: line.id,
      type: 'journey',
      source: line.a,
      target: line.b,
      data: { label: travelText(line.travel) },
    })),
  )
  const [nodes, setNodes] = useState<MapNode[]>(() => {
    const leaves = cards.filter((card) => !children.has(card.id))
    const leafIds = new Set(leaves.map((card) => card.id))
    const lines = linesOf(links, leafIds)
    const descendants = (id: string): string[] =>
      (children.get(id) ?? []).flatMap((kid) => (children.has(kid) ? descendants(kid) : [kid]))
    const placed = new Map<string, Point>()
    for (const card of leaves) {
      if (card.position) placed.set(card.id, { x: card.position.map_x, y: card.position.map_y })
    }
    const points = layout(
      leaves.map((card) => card.id),
      placed,
      lines,
      [...children.keys()].map(descendants),
    )
    const depth = (id: string, seen = new Set<string>()): number => {
      const parent = parents.find((row) => row.from_id === id)?.to_id
      if (!parent || seen.has(parent) || !children.has(parent)) return 0
      seen.add(parent)
      return 1 + depth(parent, seen)
    }
    const regionNodes: MapNode[] = leaves.map((card) => ({
      id: card.id,
      type: 'region',
      position: points.get(card.id) ?? { x: 0, y: 0 },
      origin: [0.5, 0.5],
      width: NODE_WIDTH,
      height: NODE_HEIGHT,
      draggable: !locked,
      ariaLabel: strings.map.open(card.name ?? strings.drawer.untitled),
      data: { card, episodes: episodes.get(card.id) ?? [] },
    }))
    const areaNodes: MapNode[] = cards
      .filter((card) => children.has(card.id))
      .map((card) => ({
        id: card.id,
        type: 'area',
        position: { x: 0, y: 0 },
        // Outer areas lie under inner ones; all lie under the tokens.
        zIndex: -100 + depth(card.id),
        draggable: false,
        focusable: false,
        data: { card, onPick },
      }))
    return withAreas([...areaNodes, ...regionNodes], children)
  })

  const onNodesChange = (changes: NodeChange<MapNode>[]) => {
    setNodes((current) => withAreas(applyNodeChanges(changes, current), children))
  }

  const nodeElement = (target: EventTarget) =>
    target instanceof Element ? target.closest<HTMLElement>('.react-flow__node') : null

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'Enter' && event.key !== ' ') return
    const node = nodeElement(event.target)
    const id = node?.dataset.id
    if (!node || !id || !node.classList.contains('react-flow__node-region')) return
    event.preventDefault()
    onPick(id, node.getBoundingClientRect())
  }

  // Double-click inside an area zooms to it (the innermost one under the pointer).
  const onDoubleClick = (event: MouseEvent) => {
    const instance = flow.current
    if (!instance) return
    const at = instance.screenToFlowPosition({ x: event.clientX, y: event.clientY })
    const hit = nodes
      .filter(
        (node) =>
          node.type === 'area' &&
          node.width !== undefined &&
          node.height !== undefined &&
          at.x >= node.position.x &&
          at.x <= node.position.x + node.width &&
          at.y >= node.position.y &&
          at.y <= node.position.y + node.height,
      )
      .sort((a, b) => (a.width ?? 0) * (a.height ?? 0) - (b.width ?? 0) * (b.height ?? 0))[0]
    if (!hit) return
    void instance.fitBounds(
      { x: hit.position.x, y: hit.position.y, width: hit.width ?? 0, height: hit.height ?? 0 },
      { padding: 0.15, duration: reducedMotion() ? 0 : 300 },
    )
  }

  return (
    <div className="map-sheet" onKeyDown={onKeyDown} onDoubleClick={onDoubleClick}>
      <ReactFlow<MapNode, JourneyEdge>
        nodes={nodes}
        edges={edges}
        nodeTypes={NODE_TYPES}
        edgeTypes={EDGE_TYPES}
        onNodesChange={onNodesChange}
        onInit={(instance) => {
          flow.current = instance
        }}
        onNodeClick={(event, node) => {
          if (node.type === 'region') {
            onPick(node.id, nodeElement(event.target)?.getBoundingClientRect() ?? null)
          }
        }}
        onNodeDragStop={(_, node) => {
          if (node.type === 'region') onMove(node.id, node.position)
        }}
        nodesConnectable={false}
        elementsSelectable={false}
        nodesDraggable={!locked}
        zoomOnDoubleClick={false}
        fitView
        fitViewOptions={{ padding: 0.2, maxZoom: 1.2 }}
        minZoom={0.2}
        maxZoom={2}
        proOptions={{ hideAttribution: true }}
        ariaLabelConfig={{
          'node.a11yDescription.default': 'Enter 키로 카드를 뒤집어 봐요.',
          'node.a11yDescription.keyboardDisabled': 'Enter 키로 카드를 뒤집어 봐요.',
          'edge.a11yDescription.default': '두 지역 사이의 길이에요.',
        }}
      />
    </div>
  )
}
