import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { chromium } from 'playwright'
import { browserEndpoint, matchesTarget, sessionToolNames, targetUrl } from './policy.mjs'

const endpoint = browserEndpoint(process.env.TYPSTABILITY_CDP_URL ?? 'http://127.0.0.1:9222')
const target = targetUrl(process.env.TYPSTABILITY_URL ?? 'http://localhost:5173/')
const browser = await chromium.connectOverCDP(endpoint.href)
const server = new Server({ name: 'typstability', version: '1.0.0' }, { capabilities: { tools: {} } })

function activePage() {
  const pages = browser.contexts().flatMap((context) => context.pages()).filter((page) => {
    return matchesTarget(page.url(), target)
  })
  if (pages.length !== 1) throw new Error('Open exactly one matching Typstability tab, then enable Agent access in that tab.')
  if (!pages[0].webmcp) throw new Error('This bridge requires Playwright with page.webmcp support (1.64+ or its next preview).')
  return pages[0]
}

server.setRequestHandler(ListToolsRequestSchema, async () => {
  const tools = await activePage().webmcp.tools({ timeout: 5000 })
  return { tools: tools.filter((tool) => sessionToolNames.has(tool.name)).map((tool) => ({
    name: tool.name, description: tool.description, inputSchema: tool.inputSchema ?? { type: 'object' },
    annotations: { readOnlyHint: tool.name === 'typstability_read_session', destructiveHint: tool.name === 'typstability_edit_session', openWorldHint: false },
  })) }
})
server.setRequestHandler(CallToolRequestSchema, async ({ params }) => {
  try {
    if (!sessionToolNames.has(params.name)) throw new Error('Only Typstability session tools are exposed by this bridge.')
    return await activePage().webmcp.callTool(params.name, params.arguments ?? {}, { timeout: 30000 })
  } catch (error) {
    return { isError: true, content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }] }
  }
})
await server.connect(new StdioServerTransport())
