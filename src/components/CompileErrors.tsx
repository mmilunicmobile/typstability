import { ChevronRight } from 'lucide-react'

export function CompileErrors({ error }: { error?: string }) {
  // Unix diagnostics have one file:line:column: error: header per error.
  // Explanations and hints can span several lines and must not inflate the count.
  const count = error ? Math.max(1, (error.match(/^(?:[^\n]*?:\d+:\d+(?:-\d+:\d+)?:\s*)?error:/gm) ?? []).length) : 0
  return (
    <details className={`compile-errors${count > 0 ? ' has-errors' : ''}`}>
      <summary aria-label={`${count} ${count === 1 ? 'error' : 'errors'}`}>
        <ChevronRight size={14} aria-hidden="true" />
        <span>Errors</span>
        <span className="compile-error-count">{count}</span>
      </summary>
      <pre className="compile-error-details">{error || 'No errors.'}</pre>
    </details>
  )
}
