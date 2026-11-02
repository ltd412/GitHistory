// One row of the commit graph as SVG paths, drawn like the OpenIDEA Git log (GitLog.tsx GraphCell): 14 px
// lanes, S-curves between lanes, a ringed node for HEAD. Colours are theme tokens (CSS variables).
import { JB_LANE, JB_MAX_LANES, JB_ROW, jbArrowHead, jbLaneVar, jbLaneX, jbSegPath, type JbGraphRow } from '../../lib/jb';

export function JbGraphCell({ row, head, dashedNode }: { row: JbGraphRow; head?: boolean; dashedNode?: boolean }) {
  const width = Math.min(row.width, JB_MAX_LANES) * JB_LANE;
  const cy = JB_ROW / 2;
  const x = jbLaneX;
  return (
    <svg className="jb-graph" width={width} height={JB_ROW} aria-hidden>
      {row.up.map((s, i) => (
        <path
          key={`u${i}`}
          d={jbSegPath(x(s.from), 0, x(s.to), cy) + (s.arrow ? jbArrowHead(x(s.from), 0, -1) : '')}
          stroke={jbLaneVar(s.color)}
          strokeLinecap={s.dashed ? 'butt' : 'square'}
          strokeDasharray={s.dashed ? '2 2' : undefined}
        />
      ))}
      {row.down.map((s, i) => (
        <path
          key={`d${i}`}
          d={jbSegPath(x(s.from), cy, x(s.to), JB_ROW) + (s.arrow ? jbArrowHead(x(s.to), JB_ROW, 1) : '')}
          stroke={jbLaneVar(s.color)}
          strokeLinecap={s.dashed ? 'butt' : 'square'}
          strokeDasharray={s.dashed ? '2 2' : undefined}
        />
      ))}
      {dashedNode ? (
        <circle cx={x(row.lane)} cy={cy} r={3.8} fill="var(--log-row-bg, var(--bg-app))" stroke={jbLaneVar(row.color)} strokeWidth={1.4} strokeDasharray="2 1.6" />
      ) : head ? (
        <>
          <circle cx={x(row.lane)} cy={cy} r={5} fill="var(--log-row-bg, var(--bg-app))" stroke={jbLaneVar(row.color)} strokeWidth={1.5} />
          <circle cx={x(row.lane)} cy={cy} r={2.5} fill={jbLaneVar(row.color)} />
        </>
      ) : (
        <circle cx={x(row.lane)} cy={cy} r={3.8} fill={jbLaneVar(row.color)} stroke="none" />
      )}
    </svg>
  );
}
