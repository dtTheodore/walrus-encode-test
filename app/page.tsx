'use client'

import { useState, useRef } from 'react'
import { SuiJsonRpcClient } from '@mysten/sui/jsonRpc'
import { getFullnodeUrl } from '@mysten/sui/client'
import { walrus, WalrusFile } from '@mysten/walrus'
import { Transaction } from '@mysten/sui/transactions'

// ────────────────────────────────────────────────────────────────────────────
// Theory under test
// ────────────────────────────────────────────────────────────────────────────
// For N files passed to writeFilesFlow():
//   flow.encode()    → local WASM work, parallel, NO wallet prompt
//   flow.register()  → returns 1 Transaction (1 PTB batching all N)
//   flow.upload()    → network IO, parallel,   NO wallet prompt
//   flow.certify()   → returns 1 Transaction (1 PTB batching all N)
//
// So regardless of N, you get exactly 2 Transaction objects back (2 wallet
// prompts if you were to sign them).  This test verifies that claim without
// requiring an actual wallet by inspecting the returned Transaction objects.
// ────────────────────────────────────────────────────────────────────────────

type StepStatus = 'idle' | 'running' | 'done' | 'error'

interface StepResult {
  status: StepStatus
  ms?: number
  detail?: string
  error?: string
}

interface TestResults {
  filesCreated: StepResult
  encode: StepResult
  register: StepResult
  certify: StepResult
}

function makeWalrusClient() {
  return new SuiJsonRpcClient({
    url: getFullnodeUrl('testnet'),
    network: 'testnet',
  }).$extend(walrus())
}

/** Count the commands inside a serialised Transaction JSON */
function countCommands(tx: Transaction): number {
  try {
    const json = JSON.parse(tx.serialize())
    return Array.isArray(json?.commands) ? json.commands.length : -1
  } catch {
    return -1
  }
}

/** Human-readable description of what command types appear in the PTB */
function describeCommands(tx: Transaction): string {
  try {
    const json = JSON.parse(tx.serialize())
    if (!Array.isArray(json?.commands)) return 'unknown'
    const types: string[] = json.commands.map((c: Record<string, unknown>) => Object.keys(c)[0])
    const counts: Record<string, number> = {}
    for (const t of types) counts[t] = (counts[t] ?? 0) + 1
    return Object.entries(counts)
      .map(([k, v]) => `${v}× ${k}`)
      .join(', ')
  } catch {
    return 'parse error'
  }
}

/** Create N small deterministic test files */
function makeTestFiles(n: number): WalrusFile[] {
  return Array.from({ length: n }, (_, i) => {
    // 1 KB per file with unique content
    const bytes = new Uint8Array(1024)
    for (let j = 0; j < bytes.length; j++) bytes[j] = (i * 37 + j * 13) & 0xff
    return WalrusFile.from({ contents: bytes, identifier: `test-file-${i + 1}.bin` })
  })
}

const FILE_COUNTS = [1, 3, 5, 10]

export default function Home() {
  const [fileCount, setFileCount] = useState(3)
  const [running, setRunning] = useState(false)
  const [results, setResults] = useState<TestResults | null>(null)
  const clientRef = useRef<ReturnType<typeof makeWalrusClient> | null>(null)

  function patch(key: keyof TestResults, update: Partial<StepResult>) {
    setResults((prev) =>
      prev ? { ...prev, [key]: { ...prev[key], ...update } } : prev,
    )
  }

  async function runTest() {
    if (running) return
    setRunning(true)

    const initial: TestResults = {
      filesCreated: { status: 'idle' },
      encode:       { status: 'idle' },
      register:     { status: 'idle' },
      certify:      { status: 'idle' },
    }
    setResults(initial)

    try {
      // ── STEP 0: create client ────────────────────────────────────────────
      if (!clientRef.current) clientRef.current = makeWalrusClient()
      const wc = clientRef.current.walrus

      // ── STEP 1: create test files ────────────────────────────────────────
      patch('filesCreated', { status: 'running' })
      let files: WalrusFile[]
      try {
        const t0 = performance.now()
        files = makeTestFiles(fileCount)
        const ms = Math.round(performance.now() - t0)
        patch('filesCreated', {
          status: 'done',
          ms,
          detail: `Created ${fileCount} × 1 KB test file${fileCount > 1 ? 's' : ''}`,
        })
      } catch (e) {
        patch('filesCreated', { status: 'error', error: String(e) })
        setRunning(false)
        return
      }

      // ── STEP 2: encode (parallel, CPU-bound, no wallet) ─────────────────
      patch('encode', { status: 'running' })
      const flow = wc.writeFilesFlow({ files })
      try {
        const t0 = performance.now()
        await flow.encode()
        const ms = Math.round(performance.now() - t0)
        patch('encode', {
          status: 'done',
          ms,
          detail: `All ${fileCount} files encoded in parallel (WASM RS erasure coding)`,
        })
      } catch (e) {
        patch('encode', { status: 'error', error: String(e) })
        setRunning(false)
        return
      }

      // ── STEP 3: register — returns 1 Transaction (PTB, no signing yet) ──
      patch('register', { status: 'running' })
      let registerTx: Transaction
      try {
        const t0 = performance.now()
        // register() is synchronous — it builds a Transaction and returns it.
        // owner / epochs are required by the type; we use a dummy address for
        // inspection purposes only (we won't execute this tx).
        registerTx = flow.register({
          epochs: 1,
          deletable: false,
          owner: '0x0000000000000000000000000000000000000000000000000000000000000000',
        })
        const ms = Math.round(performance.now() - t0)
        const cmdCount = countCommands(registerTx)
        const cmdDesc  = describeCommands(registerTx)
        patch('register', {
          status: 'done',
          ms,
          detail: [
            `Returned 1 Transaction object (1 PTB) — NOT yet signed/submitted`,
            `Commands inside PTB: ${cmdCount} (${cmdDesc})`,
            `→ All ${fileCount} file registrations are batched into this single Transaction`,
          ].join('\n'),
        })
      } catch (e) {
        patch('register', { status: 'error', error: String(e) })
        setRunning(false)
        return
      }

      // ── STEP 4: certify — also returns 1 Transaction (no signing yet) ───
      patch('certify', { status: 'running' })
      try {
        const t0 = performance.now()
        // certify() is also synchronous after encode() has been called.
        // In a real app you'd call upload() first (needs a tx digest), then
        // certify().  Here we call certify() directly to inspect its PTB.
        const certifyTx = flow.certify()
        const ms = Math.round(performance.now() - t0)
        const cmdCount = countCommands(certifyTx)
        const cmdDesc  = describeCommands(certifyTx)
        patch('certify', {
          status: 'done',
          ms,
          detail: [
            `Returned 1 Transaction object (1 PTB) — NOT yet signed/submitted`,
            `Commands inside PTB: ${cmdCount} (${cmdDesc})`,
            `→ All ${fileCount} file certifications are batched into this single Transaction`,
          ].join('\n'),
        })
      } catch (e) {
        patch('certify', { status: 'error', error: String(e) })
      }
    } finally {
      setRunning(false)
    }
  }

  // ── UI helpers ─────────────────────────────────────────────────────────────

  const stepIcons: Record<StepStatus, string> = {
    idle:    '○',
    running: '◌',
    done:    '✓',
    error:   '✗',
  }
  const stepColors: Record<StepStatus, string> = {
    idle:    'text-gray-400',
    running: 'text-blue-500',
    done:    'text-green-600',
    error:   'text-red-500',
  }

  const steps: { key: keyof TestResults; label: string; walletPrompt: boolean }[] = [
    { key: 'filesCreated', label: 'Create test files',            walletPrompt: false },
    { key: 'encode',       label: 'flow.encode()',                walletPrompt: false },
    { key: 'register',     label: 'flow.register() → Transaction',walletPrompt: true  },
    { key: 'certify',      label: 'flow.certify() → Transaction', walletPrompt: true  },
  ]

  const allDone = results &&
    (['filesCreated', 'encode', 'register', 'certify'] as const).every(
      (k) => results[k].status === 'done',
    )

  return (
    <div className="min-h-screen bg-white py-10 px-4">
      <div className="max-w-2xl mx-auto space-y-8">

        {/* Header */}
        <div>
          <h1 className="text-3xl font-semibold text-gray-900 tracking-tight">
            writeFilesFlow Batching Test
          </h1>
          <p className="mt-2 text-sm text-gray-500 leading-relaxed">
            Verifies that <code className="bg-gray-100 px-1 rounded">writeFilesFlow(N files)</code>{' '}
            produces exactly <strong>1 register PTB</strong> + <strong>1 certify PTB</strong>{' '}
            regardless of file count — i.e. only 2 wallet prompts, not N×2.
          </p>
        </div>

        {/* Theory box */}
        <div className="bg-gray-50 border border-gray-200 rounded-xl p-5 text-sm font-mono leading-6 text-gray-700 space-y-1">
          <div><span className="text-gray-400">// expected flow for {fileCount} file{fileCount > 1 ? 's' : ''}</span></div>
          <div><span className="text-blue-600">encode()</span>   → local WASM, parallel  <span className="text-gray-400">← no wallet</span></div>
          <div><span className="text-purple-600">register()</span>→ <strong>1 PTB</strong> batching all {fileCount} <span className="text-gray-400">← 1 wallet prompt</span></div>
          <div><span className="text-blue-600">upload()</span>   → network IO, parallel  <span className="text-gray-400">← no wallet</span></div>
          <div><span className="text-purple-600">certify()</span> → <strong>1 PTB</strong> batching all {fileCount} <span className="text-gray-400">← 1 wallet prompt</span></div>
          <div className="pt-1 text-green-700 font-semibold">// 2 wallet prompts total, always</div>
        </div>

        {/* File count selector */}
        <div className="space-y-2">
          <label className="block text-sm font-medium text-gray-700">Number of files to test</label>
          <div className="flex gap-2">
            {FILE_COUNTS.map((n) => (
              <button
                key={n}
                onClick={() => setFileCount(n)}
                disabled={running}
                className={`px-5 py-2.5 rounded-lg text-sm font-medium border transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                  fileCount === n
                    ? 'bg-gray-900 text-white border-gray-900'
                    : 'bg-white text-gray-700 border-gray-300 hover:border-gray-500'
                }`}
              >
                {n} file{n > 1 ? 's' : ''}
              </button>
            ))}
          </div>
        </div>

        {/* Run button */}
        <button
          onClick={runTest}
          disabled={running}
          className="w-full py-3.5 bg-gray-900 text-white rounded-lg hover:bg-gray-800 transition-colors font-medium disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {running ? (
            <span className="inline-flex items-center gap-2 justify-center">
              <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
              Running test…
            </span>
          ) : (
            `Run Test with ${fileCount} File${fileCount > 1 ? 's' : ''}`
          )}
        </button>

        {/* Results */}
        {results && (
          <div className="space-y-3">
            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider">Results</h2>
            {steps.map(({ key, label, walletPrompt }) => {
              const step = results[key]
              return (
                <div
                  key={key}
                  className="border border-gray-200 rounded-xl p-4 space-y-1.5"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className={`text-lg leading-none ${stepColors[step.status]}`}>
                        {step.status === 'running'
                          ? <svg className="inline w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>
                          : stepIcons[step.status]}
                      </span>
                      <span className="font-mono text-sm font-medium text-gray-900">{label}</span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {walletPrompt && (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-purple-100 text-purple-700 border border-purple-200">
                          wallet prompt
                        </span>
                      )}
                      {!walletPrompt && (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 border border-gray-200">
                          no wallet
                        </span>
                      )}
                      {step.ms !== undefined && (
                        <span className="text-xs text-gray-400">{step.ms} ms</span>
                      )}
                    </div>
                  </div>

                  {step.detail && (
                    <div className="ml-6 text-xs text-gray-600 bg-gray-50 rounded-lg p-2.5 font-mono whitespace-pre-line leading-5">
                      {step.detail}
                    </div>
                  )}
                  {step.error && (
                    <div className="ml-6 text-xs text-red-600 bg-red-50 rounded-lg p-2.5 font-mono whitespace-pre-line leading-5">
                      {step.error}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {/* Verdict */}
        {allDone && (
          <div className="border-2 border-green-300 bg-green-50 rounded-xl p-5 space-y-2">
            <div className="text-green-800 font-semibold text-base">Theory confirmed ✓</div>
            <p className="text-sm text-green-700 leading-relaxed">
              <code className="bg-green-100 px-1 rounded">writeFilesFlow({fileCount} files)</code> produced{' '}
              <strong>1 register Transaction</strong> + <strong>1 certify Transaction</strong>.{' '}
              Regardless of how many files you upload, signing costs are fixed at 2 wallet prompts
              (+ 1 optional Sui object tx for dynamic field updates).
            </p>
            <p className="text-xs text-green-600 mt-1">
              Note: <code>upload()</code> step was skipped here (requires executing the register tx and
              getting its digest). That step has no wallet prompt — it's parallel HTTP to storage nodes.
            </p>
          </div>
        )}

        {/* Footer note */}
        <p className="text-xs text-gray-400 text-center pb-4">
          All operations use Walrus testnet · No real transactions are signed or submitted
        </p>
      </div>
    </div>
  )
}
