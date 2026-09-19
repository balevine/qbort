import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { MCP_PROMPTS, MCP_RESOURCES, MCP_TOOLS, createMcpServer } from '@mcp/server.mjs'

describe('createMcpServer', () => {
  let testDir: string
  let server: ReturnType<typeof createMcpServer>

  beforeEach(async () => {
    testDir = await fs.mkdtemp(join(tmpdir(), 'qbort-mcp-test-'))
    server = createMcpServer({ defaultWorkingDir: testDir })
  })

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true })
  })

  it('exposes defined tools, resources, and prompts', () => {
    expect(server.tools.map((t) => t.name)).toContain('plan_ticket_run')
    expect(server.tools.map((t) => t.name)).toContain('assemble_tickets')
    expect(server.tools.map((t) => t.name)).toContain('view_tickets')
    expect(server.resources.map((r) => r.uri)).toContain('qbort://template/ticket-prompt')
    expect(server.prompts.map((p) => p.name)).toContain('generate-tickets')
  })

  describe('protocol handling', () => {
    it('handles initialize and returns capabilities and serverInfo', async () => {
      const res = (await server.handleMessage({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { protocolVersion: '2024-11-05' }
      })) as any
      expect(res).not.toBeNull()
      expect(res?.result?.protocolVersion).toBe('2024-11-05')
      expect(res?.result?.serverInfo?.name).toBe('qbort-mcp')
      expect(res?.result?.capabilities?.tools).toBeDefined()
      expect(res?.result?.capabilities?.resources).toBeDefined()
      expect(res?.result?.capabilities?.prompts).toBeDefined()
    })

    it('handles notifications/initialized by returning null', async () => {
      const res = await server.handleMessage({
        jsonrpc: '2.0',
        method: 'notifications/initialized'
      })
      expect(res).toBeNull()
    })

    it('handles ping', async () => {
      const res = await server.handleMessage({
        jsonrpc: '2.0',
        id: 'req-ping',
        method: 'ping'
      })
      expect(res).toEqual({ jsonrpc: '2.0', id: 'req-ping', result: {} })
    })

    it('returns tools/list', async () => {
      const res = (await server.handleMessage({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/list'
      })) as any
      expect(res?.result?.tools).toHaveLength(MCP_TOOLS.length)
    })

    it('returns resources/list', async () => {
      const res = (await server.handleMessage({
        jsonrpc: '2.0',
        id: 3,
        method: 'resources/list'
      })) as any
      expect(res?.result?.resources).toHaveLength(MCP_RESOURCES.length)
    })

    it('returns prompts/list', async () => {
      const res = (await server.handleMessage({
        jsonrpc: '2.0',
        id: 4,
        method: 'prompts/list'
      })) as any
      expect(res?.result?.prompts).toHaveLength(MCP_PROMPTS.length)
    })

    it('returns method not found for unknown methods', async () => {
      const res = (await server.handleMessage({
        jsonrpc: '2.0',
        id: 5,
        method: 'unknown/method'
      })) as any
      expect(res?.error?.code).toBe(-32601)
    })

    it('handles JSON string inputs and parse errors', async () => {
      const bad = (await server.handleMessage('{ invalid json')) as any
      expect(bad?.error?.code).toBe(-32700)

      const good = (await server.handleMessage(JSON.stringify({ jsonrpc: '2.0', id: 6, method: 'ping' }))) as any
      expect(good?.result).toEqual({})
    })
  })


  describe('scaffold_ticket_prompt', () => {
    it('creates TICKET_PROMPT.md in target directory', async () => {
      const res = await server.callTool('scaffold_ticket_prompt', { targetDir: testDir })
      expect(res.isError).toBe(false)
      const data = JSON.parse(res.content[0].text)
      expect(data.created).toBe(true)
      expect(data.path).toBe(join(testDir, 'TICKET_PROMPT.md'))

      const fileOnDisk = await fs.readFile(data.path, 'utf-8')
      expect(fileOnDisk).toContain('You generate realistic but fake customer support tickets')

      // Second run without overwrite returns created: false
      const second = await server.callTool('scaffold_ticket_prompt', { targetDir: testDir })
      expect(JSON.parse(second.content[0].text).created).toBe(false)
    })
  })

  describe('ticket generation pipeline via MCP tools', () => {
    it('plans, batches, and assembles tickets end-to-end', async () => {
      // 1. Scaffold prompt
      await server.callTool('scaffold_ticket_prompt', { targetDir: testDir })

      // 2. Plan run
      const planRes = await server.callTool('plan_ticket_run', {
        workingDir: testDir,
        count: 4,
        batchSize: 2,
        includeStaffResponses: true,
        avgStaffResponses: 1,
        numStaffMembers: 3,
        maxTicketAgeDays: 30
      })
      expect(planRes.isError).toBe(false)
      const planData = JSON.parse(planRes.content[0].text)
      expect(planData.plannedTickets).toBe(4)
      expect(planData.scenarioCount).toBeGreaterThanOrEqual(4)
      expect(planData.scenarioPrompt).toContain('one-line ticket scenarios')

      // 3. Build batches with scenarios

      const scenarios = ['Bug in login modal', 'Billing card expired', 'Export CSV empty', 'Invite link 404', 'Spare 1', 'Spare 2']
      const batchRes = await server.callTool('build_ticket_batches', {
        workingDir: testDir,
        scenarios
      })
      expect(batchRes.isError).toBe(false)
      const batchData = JSON.parse(batchRes.content[0].text)
      expect(batchData.batches).toHaveLength(2)
      expect(batchData.batches[0].count).toBe(2)
      expect(batchData.batches[1].count).toBe(2)
      expect(batchData.batches[0].promptText).toContain('Ticket scenarios')

      // 4. Assemble tickets using in-memory batch payload

      const batch0Tickets = [
        {
          subject: 'Cannot login with OAuth',
          status: 'open',
          messages: [
            {
              from: { name: 'Customer One', email: 'cust1@external.org' },
              body: 'Getting a 500 error when clicking Google login'
            },
            {
              from: { name: 'Staff Person', email: 'first.last@company.biz' },
              body: 'We deployed a fix, please try again.'
            }
          ]
        },
        {
          subject: 'Card was charged twice',
          status: 'solved',
          messages: [
            {
              from: { name: 'Customer Two', email: 'cust2@corp.io' },
              body: 'I see two charges for invoice #1234'
            }
          ]
        }
      ]

      const batch1Tickets = [
        {
          subject: 'CSV export produces empty file',
          status: 'pending',
          messages: [
            {
              from: { name: 'Customer Three', email: 'cust3@test.net' },
              body: 'The exported file is 0 bytes'
            }
          ]
        },
        {
          subject: 'Need access to workspace',
          status: 'closed',
          messages: [
            {
              from: { name: 'Customer Four', email: 'cust4@team.org' },
              body: 'My invite expired'
            }
          ]
        }
      ]

      const assembleRes = await server.callTool('assemble_tickets', {
        workingDir: testDir,
        round: 0,
        batches: [
          { index: 0, tickets: batch0Tickets },
          { index: 1, tickets: batch1Tickets }
        ]
      })

      expect(assembleRes.isError).toBe(false)
      const assembleData = JSON.parse(assembleRes.content[0].text)
      expect(assembleData.keptCount).toBe(4)
      expect(assembleData.requestedCount).toBe(4)
      expect(assembleData.shortfall).toBe(0)
      expect(assembleData.isComplete).toBe(true)
      expect(await fs.stat(assembleData.outputFile)).toBeDefined()

      // 5. Inspect using list_ticket_runs
      const listRes = await server.callTool('list_ticket_runs', { workingDir: testDir })
      expect(listRes.isError).toBe(false)
      const listData = JSON.parse(listRes.content[0].text)
      expect(listData.count).toBe(1)
      expect(listData.runs[0].generatedCount).toBe(4)

      // 6. Inspect using get_run_stats
      const statsRes = await server.callTool('get_run_stats', { workingDir: testDir })
      expect(statsRes.isError).toBe(false)
      const statsData = JSON.parse(statsRes.content[0].text)
      expect(statsData.stats.totalTickets).toBe(4)
      expect(statsData.stats.byStatus.open).toBe(1)
      expect(statsData.stats.byStatus.solved).toBe(1)

      // 7. Inspect using view_tickets
      const viewRes = await server.callTool('view_tickets', {
        workingDir: testDir,
        search: 'OAuth',
        full: true
      })
      expect(viewRes.isError).toBe(false)
      const viewData = JSON.parse(viewRes.content[0].text)
      expect(viewData.totalMatched).toBe(1)
      expect(viewData.tickets[0].id).toBe(1)
      expect(viewData.tickets[0].subject).toBe('Cannot login with OAuth')

      // 8. Inspect using get_ticket
      const getRes = await server.callTool('get_ticket', {
        workingDir: testDir,
        id: 1
      })
      expect(getRes.isError).toBe(false)
      const getData = JSON.parse(getRes.content[0].text)
      expect(getData.ticket.id).toBe(1)
      expect(getData.ticket.messages).toHaveLength(2)

      // 9. Read through MCP resources
      const resLatest = await server.readResource('qbort://runs/latest')
      expect(JSON.parse(resLatest.contents[0].text).tickets).toHaveLength(4)

      const resStats = await server.readResource('qbort://runs/latest/stats')
      expect(JSON.parse(resStats.contents[0].text).stats.totalTickets).toBe(4)

      const resPrompt = await server.readResource('qbort://template/ticket-prompt')
      expect(resPrompt.contents[0].text).toContain('You generate realistic but fake customer support tickets')
    })

    it('supports topup rounds when shortfall occurs', async () => {
      await server.callTool('scaffold_ticket_prompt', { targetDir: testDir })
      await server.callTool('plan_ticket_run', {
        workingDir: testDir,
        count: 4,
        batchSize: 2
      })
      await server.callTool('build_ticket_batches', {
        workingDir: testDir,
        scenarios: ['S1', 'S2', 'S3', 'S4', 'S5', 'S6']
      })

      // Batch 0 provides only 1 valid ticket, Batch 1 dropped entirely
      const assembleRes = await server.callTool('assemble_tickets', {
        workingDir: testDir,
        round: 0,
        batches: [
          {
            index: 0,
            tickets: [
              {
                subject: 'Only ticket',
                status: 'open',
                messages: [{ from: { name: 'A', email: 'a@test.org' }, body: 'Body' }]
              }
            ]
          },
          {
            index: 1,
            rawJson: 'invalid json garbage'
          }
        ]
      })

      const assembleData = JSON.parse(assembleRes.content[0].text)
      expect(assembleData.keptCount).toBe(1)
      expect(assembleData.shortfall).toBe(3)
      expect(assembleData.isComplete).toBe(false)

      // Call prepare_topup for round 1
      const topupRes = await server.callTool('prepare_topup', {
        workingDir: testDir,
        round: 1
      })
      expect(topupRes.isError).toBe(false)
      const topupData = JSON.parse(topupRes.content[0].text)
      expect(topupData.round).toBe(1)
      expect(topupData.shortfall).toBe(3)
      expect(topupData.batches.length).toBeGreaterThanOrEqual(1)
    })
  })

  describe('prompts handling', () => {
    it('returns generate-tickets prompt guidance', async () => {
      const res = await server.getPrompt('generate-tickets', {
        product: 'SuperTool CRM',
        count: 25,
        includeStaff: 'true'
      })
      expect(res.messages[0].content.text).toContain('SuperTool CRM')
      expect(res.messages[0].content.text).toContain('25')
      expect(res.messages[0].content.text).toContain('plan_ticket_run')
    })

    it('returns review-tickets prompt guidance', async () => {
      const res = await server.getPrompt('review-tickets', { focus: 'tone and response times' })
      expect(res.messages[0].content.text).toContain('tone and response times')
      expect(res.messages[0].content.text).toContain('get_run_stats')
    })
  })

  describe('stdio subprocess integration', () => {
    it('initializes and pings over stdio child process', async () => {
      const { spawn } = await import('node:child_process')
      const { resolve } = await import('node:path')
      const serverPath = resolve('plugin/mcp/server.mjs')

      const proc = spawn(process.execPath, [serverPath], {
        stdio: ['pipe', 'pipe', 'pipe']
      })

      const responses: any[] = []
      let buffer = ''

      proc.stdout.setEncoding('utf-8')
      proc.stdout.on('data', (chunk) => {
        buffer += chunk
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''
        for (const line of lines) {
          if (line.trim()) {
            responses.push(JSON.parse(line))
          }
        }
      })

      // Send initialize
      proc.stdin.write(
        JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: { protocolVersion: '2024-11-05' }
        }) + '\n'
      )

      // Send ping
      proc.stdin.write(
        JSON.stringify({
          jsonrpc: '2.0',
          id: 2,
          method: 'ping'
        }) + '\n'
      )

      await new Promise<void>((resolvePromise) => {
        const interval = setInterval(() => {
          if (responses.length >= 2) {
            clearInterval(interval)
            resolvePromise()
          }
        }, 20)
      })

      const resInit = responses.find((r) => r.id === 1)
      const resPing = responses.find((r) => r.id === 2)
      expect(resInit?.result?.serverInfo?.name).toBe('qbort-mcp')
      expect(resPing?.result).toEqual({})


      proc.stdin.end()
      await new Promise<void>((resolvePromise) => proc.on('close', () => resolvePromise()))
    })
  })
})

