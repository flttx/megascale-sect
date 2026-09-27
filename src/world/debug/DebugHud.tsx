import { useWorldStore } from '../store'

export function DebugHud() {
  const telemetry = useWorldStore((state) => state.telemetry)
  const assets = useWorldStore((state) => state.assets)
  const quality = useWorldStore((state) => state.quality)
  const autoQuality = useWorldStore((state) => state.autoQuality)
  return (
    <aside className="debug-hud">
      <div className="debug-heading">FIELD DIAGNOSTICS <span>F3</span></div>
      <dl>
        <dt>FPS</dt><dd>{telemetry.fps.toFixed(0)}</dd>
        <dt>POSITION</dt><dd>{telemetry.position.map((n) => n.toFixed(1)).join(' / ')}</dd>
        <dt>MODE</dt><dd>{telemetry.mode}</dd>
        <dt>SPEED</dt><dd>{telemetry.speed.toFixed(1)} m/s</dd>
        <dt>MG01 DIST</dt><dd>{telemetry.distance.toFixed(0)} m</dd>
        <dt>ALTITUDE</dt><dd>{telemetry.altitude.toFixed(1)} m</dd>
        <dt>DRAW CALLS</dt><dd>{telemetry.drawCalls}</dd>
        <dt>TRIANGLES</dt><dd>{telemetry.triangles.toLocaleString()}</dd>
        <dt>QUALITY</dt><dd>{quality.toUpperCase()}{autoQuality ? ' · AUTO' : ''} · DPR {telemetry.dpr.toFixed(2)}</dd>
      </dl>
      <div className="debug-assets">
        <b>ASSET INGEST</b>
        {Object.entries(assets).map(([id, report]) => <div key={id}>{report}</div>)}
      </div>
      <div className="debug-footer">G · grid / bounds / ramp collider</div>
    </aside>
  )
}
