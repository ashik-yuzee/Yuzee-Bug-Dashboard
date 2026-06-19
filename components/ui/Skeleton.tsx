export function SkeletonLine({ w = '100%', h = 14, style }: { w?: string | number; h?: number; style?: React.CSSProperties }) {
  return (
    <div
      className="skeleton"
      aria-hidden="true"
      style={{ width: w, height: h, borderRadius: 4, flexShrink: 0, ...style }}
    />
  )
}

export function SkeletonCard({ h = 100, style }: { h?: number; style?: React.CSSProperties }) {
  return (
    <div
      className="skeleton"
      aria-hidden="true"
      style={{ width: '100%', height: h, borderRadius: 'var(--r-lg)', ...style }}
    />
  )
}

export function SkeletonKpiGrid() {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6,1fr)', gap: 12 }} aria-hidden="true">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} style={{ background: 'var(--surface-1)', border: '1px solid var(--border)', borderRadius: 'var(--r-lg)', padding: 16 }}>
          <SkeletonLine w={60} h={11} style={{ marginBottom: 8 }} />
          <SkeletonLine w={48} h={28} style={{ marginBottom: 6 }} />
          <SkeletonLine w={80} h={11} />
        </div>
      ))}
    </div>
  )
}

export function SkeletonTableRow() {
  return (
    <tr aria-hidden="true">
      {[32,40,72,220,70,80,70,80,70,60,32,50,60].map((w, i) => (
        <td key={i} style={{ padding: '10px 12px' }}>
          <SkeletonLine w={w} h={13} />
        </td>
      ))}
    </tr>
  )
}

export function SkeletonTable({ rows = 8 }: { rows?: number }) {
  return (
    <div style={{ padding: '0 0 16px', overflowX: 'auto' }} aria-label="Loading bug reports…" role="status">
      <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 960 }}>
        <tbody>
          {Array.from({ length: rows }).map((_, i) => (
            <SkeletonTableRow key={i} />
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function SkeletonOverview() {
  return (
    <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 20 }} aria-label="Loading overview…" role="status">
      <SkeletonKpiGrid />
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 16 }}>
        <SkeletonCard h={200} />
        <SkeletonCard h={200} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '3fr 2fr', gap: 16 }}>
        <SkeletonCard h={240} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} h={50} />)}
        </div>
      </div>
    </div>
  )
}
