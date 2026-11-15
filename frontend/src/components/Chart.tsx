import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { CHART_HEIGHT, chartGeometry, dragRange, nearestPoint, pointKey, uniqueTicks, type PlotPoint, type SelectionKind } from "../photometry";

type Scales = ReturnType<typeof chartGeometry>;
interface Props {
  points: PlotPoint[];
  invertY?: boolean;
  laneLabel?: string;
  pointOpacity?: number;
  /** Extra values the y range must include, such as a shaded band. Pass a stable (memoised) array. */
  extraY?: number[];
  title: string;
  xLabel: string;
  yLabel: string;
  xFormat: (value: number) => string;
  colour?: (point: PlotPoint) => string;
  tooltip: (point: PlotPoint) => ReactNode;
  highlightedId?: string;
  selectedKey?: string;
  onSelect: (kind: SelectionKind, key?: string) => void;
  underlay?: (scales: Scales) => ReactNode;
  overlay?: (scales: Scales) => ReactNode;
  onPointClick?: (point: PlotPoint) => void;
  /** Id of the point to ring as "shown elsewhere" (the frame in the player). */
  markedId?: string;
  /** Dragging across the plot (mouse or pen) reports the x range; a short drag stays a click. */
  onRangeSelect?: (lo: number, hi: number) => void;
}

/** Responsive scatter chart. Layer callbacks share the exact scales used by the marks. */
export default function Chart({ points, title, xLabel, yLabel, xFormat, colour, tooltip,
  highlightedId, selectedKey, onSelect, underlay, overlay, onPointClick, invertY = false, laneLabel = "Not measured", pointOpacity = 1, extraY, markedId, onRangeSelect }: Props) {
  const wrapper = useRef<HTMLDivElement>(null);
  const card = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const selected = points.find((p) => pointKey(p) === selectedKey);
  const [cardSize, setCardSize] = useState({ width: 220, height: 140 });
  const [drag, setDrag] = useState<{ start: number; end: number } | null>(null);
  const lastPointer = useRef("mouse");
  const suppressClick = useRef(false);
  const clip = useId();
  const height = CHART_HEIGHT;
  const scales = useMemo(() => chartGeometry(points, width, height, invertY, extraY), [points, width, height, invertY, extraY]);
  const { sx, sy, y0, y1, plot, floor, lane, xTicks, yTicks, positioned } = scales;
  const active = positioned.find((p) => p.point === selected);
  const hasActive = active !== undefined;
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => setWidth(Math.floor(entry.contentRect.width)));
    observer.observe(wrapper.current!);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!card.current) return;
    const observer = new ResizeObserver(([entry]) => {
      const bounds = card.current!.getBoundingClientRect();
      setCardSize({ width: entry.borderBoxSize?.[0]?.inlineSize ?? bounds.width, height: entry.borderBoxSize?.[0]?.blockSize ?? bounds.height });
    });
    observer.observe(card.current);
    return () => observer.disconnect();
  }, [hasActive]);
  const select = (kind: SelectionKind, point?: PlotPoint) => onSelect(kind, point ? pointKey(point) : undefined);
  const pxOf = (event: React.MouseEvent<SVGRectElement>) => event.clientX - event.currentTarget.ownerSVGElement!.getBoundingClientRect().left;
  const locate = (event: React.MouseEvent<SVGRectElement>) => {
    const bounds = event.currentTarget.ownerSVGElement!.getBoundingClientRect();
    return nearestPoint(positioned, event.clientX - bounds.left, event.clientY - bounds.top)?.point;
  };
  const dragged = drag ? dragRange(drag.start, drag.end, scales) : null;
  const clampPx = (px: number) => Math.min(plot.left + plot.width, Math.max(plot.left, px));
  const tipLeft = active ? Math.max(4, Math.min(width - cardSize.width - 4,
    active.px + 16 + cardSize.width < width ? active.px + 16 : active.px - cardSize.width - 16)) : 0;
  const tipTop = active ? Math.max(4, Math.min(height - cardSize.height - 4, active.py - 30)) : 0;
  return (
    <div className="chart-wrap" ref={wrapper} style={{ height }}>
      <span className="chart-announcement" aria-live="polite" aria-atomic="true">{selected?.label}</span>
      {width > 0 && <svg width={width} height={height} className="plot" role="img"
        aria-label={`${title}, ${points.length} points. ${selected?.label ?? ""}`} tabIndex={0}
        onBlur={() => onSelect("keyboard")}
        onKeyDown={(event) => {
          if (event.key === "Escape") { setDrag(null); onSelect("keyboard"); onSelect("pointer"); event.preventDefault(); return; }
          if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
          event.preventDefault();
          const ordered = [...points].sort((a, b) => a.x - b.x);
          const index = selected ? ordered.indexOf(selected) : -1;
          const next = index < 0 ? (event.key === "ArrowRight" ? 0 : ordered.length - 1)
            : Math.max(0, Math.min(ordered.length - 1, index + (event.key === "ArrowRight" ? 1 : -1)));
          onSelect("pointer");
          select("keyboard", ordered[next]);
        }}>
        <defs><clipPath id={clip}><rect x={plot.left} y={plot.top} width={plot.width} height={plot.height} /></clipPath></defs>
        <g clipPath={`url(#${clip})`}>{underlay?.(scales)}</g>
        {yTicks.map((t) => <g key={t}>
          <line x1={plot.left} x2={plot.left + plot.width} y1={sy(t)} y2={sy(t)} className="grid" />
          <text x={plot.left - 8} y={sy(t) + 4} textAnchor="end" className="tick">{t}</text>
        </g>)}
        {uniqueTicks(xTicks, xFormat).map((t) => <text key={t} x={sx(t)} y={floor + lane + 17} textAnchor="middle" className="tick">{xFormat(t)}</text>)}
        {y0 < 0 && y1 > 0 && <line x1={plot.left} x2={plot.left + plot.width} y1={sy(0)} y2={sy(0)} className="zero" />}
        <line x1={plot.left} x2={plot.left + plot.width} y1={floor} y2={floor} className="axis" />
        {lane > 0 && <text x={4} y={floor + 13} className="lane-label">{laneLabel}</text>}
        <text x={plot.left + plot.width / 2} y={height - 7} textAnchor="middle" className="label">{xLabel}</text>
        <text transform={`translate(15 ${plot.top + plot.height / 2}) rotate(-90)`} textAnchor="middle" className="label">{yLabel}</text>
        {positioned.map(({ point: p, px, py }, i) => {
          const highlighted = p === selected || (p.id !== undefined && p.id === highlightedId);
          const dim = (active || highlightedId) && !highlighted;
          return <g key={p.id ?? i} className="point" style={{ color: colour?.(p), opacity: highlighted ? 1 : dim ? Math.min(0.35, pointOpacity) : pointOpacity }}>
            {highlighted && <line x1={px} x2={px} y1={plot.top} y2={floor} className="guide" />}
            {p.y !== null && <g clipPath={`url(#${clip})`}>
              {p.err !== null && <line x1={px} x2={px} y1={sy(p.y - p.err)} y2={sy(p.y + p.err)} className="error-bar" />}
              {p.xerr !== undefined && <line x1={sx(p.x - p.xerr)} x2={sx(p.x + p.xerr)} y1={py} y2={py} className="bandpass" />}
            </g>}
            <circle cx={px} cy={py} r={highlighted ? 7 : 5} className={p.y === null ? "unmeasured" : "dot"} />
            {highlighted && <circle cx={px} cy={py} r={9} className="highlight-ring" />}
            {p.id !== undefined && p.id === markedId && <circle cx={px} cy={py} r={8} className="frame-ring" />}
          </g>;
        })}
        <g clipPath={`url(#${clip})`} aria-hidden="true" pointerEvents="none">{overlay?.(scales)}</g>
        {drag && <g className="drag-band" pointerEvents="none">
          <rect x={clampPx(Math.min(drag.start, drag.end))} y={plot.top} height={plot.height}
            width={clampPx(Math.max(drag.start, drag.end)) - clampPx(Math.min(drag.start, drag.end))} />
          {dragged && <text x={clampPx(Math.min(drag.start, drag.end)) + 4} y={plot.top + 12}>{xFormat(dragged.lo)}–{xFormat(dragged.hi)} µm</text>}
        </g>}
        <rect x={plot.left} y={plot.top} width={plot.width} height={plot.height + lane}
          fill="transparent" className={selected && onPointClick ? "hit pointing" : onRangeSelect ? "hit ranging" : "hit"}
          onPointerDown={(event) => {
            lastPointer.current = event.pointerType;
            if (!onRangeSelect || event.pointerType === "touch" || event.button !== 0) return;
            event.currentTarget.setPointerCapture?.(event.pointerId);
            setDrag({ start: pxOf(event), end: pxOf(event) });
          }}
          onPointerMove={(event) => {
            if (drag) { setDrag({ ...drag, end: pxOf(event) }); return; }
            if (event.pointerType !== "touch") select("pointer", locate(event));
          }}
          onPointerUp={() => {
            if (!drag) return;
            setDrag(null);
            if (dragged) { suppressClick.current = true; onRangeSelect?.(dragged.lo, dragged.hi); }
          }}
          onPointerLeave={(event) => { if (event.pointerType !== "touch" && !drag) onSelect("pointer"); }}
          onPointerCancel={() => { setDrag(null); onSelect("pointer"); }}
          onClick={(event) => {
            if (suppressClick.current) { suppressClick.current = false; return; }
            const p = locate(event);
            // On touch the first tap only shows the tooltip; a second tap on the same point acts.
            const firstTap = lastPointer.current === "touch" && (!p || pointKey(p) !== selectedKey);
            select("pointer", p);
            if (p && !firstTap) onPointClick?.(p);
          }} />
      </svg>}
      {active && <div ref={card} className="chart-tooltip" role="tooltip" style={{ left: tipLeft, top: tipTop }}>{tooltip(active.point)}</div>}
    </div>
  );
}
