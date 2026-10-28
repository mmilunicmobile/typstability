import type { useWebMcp } from '../lib/use-webmcp'

type Props = ReturnType<typeof useWebMcp>

export function AgentAccess({ enabled, setEnabled, status }: Props) {
  return <details className="agent-access">
    <summary>Agent access{enabled ? ' · On' : ''}</summary>
    <div className="agent-access-panel">
      <strong>Bring your own agent</strong>
      <p>Connect your local Codex, Claude, or another agent through a WebMCP browser bridge.</p>
      <label><input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} /> Allow agents to read and edit this session</label>
      <p role="status">{status}</p>
      <p>Agents can read text and layout, edit Typst source and shared styles, and manage pages. Edits appear here, autosave, and support Undo. Access turns off when you leave the project.</p>
      <a href="https://github.com/mmilunicmobile/typstability/blob/main/docs/agents.md" target="_blank" rel="noreferrer">Connection instructions</a>
    </div>
  </details>
}
