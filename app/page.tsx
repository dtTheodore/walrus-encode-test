'use client'

import { useState, useRef } from 'react'
import {
  ConnectButton,
  useCurrentAccount,
  useSignAndExecuteTransaction,
  useSuiClient,
} from '@mysten/dapp-kit'
import { walrus, WalrusFile } from '@mysten/walrus'
import { SuiJsonRpcClient } from '@mysten/sui/jsonRpc'
import { getFullnodeUrl } from '@mysten/sui/client'

// ─── Theory under test ────────────────────────────────────────────────────────
// For N files passed to writeFilesFlow():
//   Step 1  encode()    → local WASM, parallel, NO wallet prompt
//   Step 2  register()  → sign 1 Transaction (1 PTB, all N blobs batched)
//   Step 3  upload()    → parallel HTTP to storage nodes, NO wallet prompt
//   Step 4  certify()   → sign 1 Transaction (1 PTB, all N blobs batched)
//
// Expected: exactly 2 wallet prompts regardless of N.
// ─────────────────────────────────────────────────────────────────────────────

type Status = 'idle' | 'running' | 'done' | 'error'

interface StepResult {
  status: Status
  ms?: number
  detail?: string
  error?: string
}

interface FlowResults {
  encode:   StepResult
  register: StepResult
  upload:   StepResult
  certify:  StepResult
  files:    StepResult
}

const FILE_COUNTS = [1, 3, 5, 10]
const EPOCHS = 1

function makeTestFiles(n: number): WalrusFile[] {
  return Array.from({ length: n }, (_, i) => {
    const bytes = new Uint8Array(1024)
    for (let j = 0; j < bytes.length; j++) bytes[j] = (i * 37 + j * 13) & 0xff
    return WalrusFile.from({ contents: bytes, identifier: `test-file-${i + 1}.bin` })
  })
}

// Standalone walrus client for flow operations (not gated by dapp-kit provider)
function makeWalrusClient() {
  return new SuiJsonRpcClient({
    url: getFullnodeUrl('testnet'),
    network: 'testnet',
  }).$extend(walrus())
}

// ─── Status badge ──────────────────────────────────────────────────────────────
function StatusBadge({ status }: { status: Status }) {
  if (status === 'idle') return <span className="text-xs text-gray-400">—</span>
  if (status === 'running') return (
    <svg className="w-4 h-4 animate-spin text-blue-500" fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  )
  if (status === 'done') return <span className="text-green-600 font-bold">✓</span>
  return <span className="text-red-500 font-bold">✗</span>
}

export default function Home() {
  const account = useCurrentAccount()
  const suiClient = useSuiClient()
  const { mutateAsync: signAndExecute } = useSignAndExecuteTransaction()

  const [fileCount, setFileCount] = useState(3)
  const [running, setRunning] = useState(false)
  const [results, setResults] = useState<FlowResults | null>(null)
  const [walletPromptCount, setWalletPromptCount] = useState(0)
  const walrusClientRef = useRef<ReturnType<typeof makeWalrusClient> | null>(null)

  function getWalrusClient() {
    if (!walrusClientRef.current) walrusClientRef.current = makeWalrusClient()
    return walrusClientRef.current.walrus
  }

  function patchStep(key: keyof FlowResults, update: Partial<StepResult>) {
    setResults(prev => prev ? { ...prev, [key]: { ...prev[key], ...update } } : prev)
  }

  async function runFlow() {
    if (!account || running) return

    setRunning(true)
    setWalletPromptCount(0)

    const fresh: FlowResults = {
      encode:   { status: 'idle' },
      register: { status: 'idle' },
      upload:   { status: 'idle' },
      certify:  { status: 'idle' },
      files:    { status: 'idle' },
    }
    setResults(fresh)

    const wc = getWalrusClient()
    const files = makeTestFiles(fileCount)
    const flow = wc.writeFilesFlow({ files })

    try {
      // ── Step 1: encode ───────────────────────────────────────────────────
      patchStep('encode', { status: 'running' })
      const t0 = performance.now()
      await flow.encode()
      patchStep('encode', {
        status: 'done',
        ms: Math.round(performance.now() - t0),
        detail: `${fileCount} files encoded in parallel (WASM erasure coding) — no wallet prompt`,
      })

      // ── Step 2: register ─────────────────────────────────────────────────
      // register() returns 1 Transaction batching all N blobs
      patchStep('register', { status: 'running', detail: 'Waiting for wallet signature…' })
      const t1 = performance.now()
      const registerTx = flow.register({ epochs: EPOCHS, deletable: false, owner: account.address })

      setWalletPromptCount(c => c + 1)  // about to prompt wallet

      let registerDigest: string
      try {
        const result = await signAndExecute({ transaction: registerTx })
        registerDigest = result.digest
      } catch (e) {
        patchStep('register', { status: 'error', error: `Wallet rejected or failed: ${e}` })
        return
      }

      // Wait for finality so storage nodes can verify the on-chain registration
      await suiClient.waitForTransaction({ digest: registerDigest })

      patchStep('register', {
        status: 'done',
        ms: Math.round(performance.now() - t1),
        detail: [
          `1 wallet prompt → 1 Transaction signed & executed`,
          `All ${fileCount} blob registration${fileCount > 1 ? 's' : ''} batched in a single PTB`,
          `Digest: ${registerDigest}`,
        ].join('\n'),
      })

      // ── Step 3: upload ───────────────────────────────────────────────────
      patchStep('upload', { status: 'running' })
      const t2 = performance.now()
      try {
        await flow.upload({ digest: registerDigest })
        patchStep('upload', {
          status: 'done',
          ms: Math.round(performance.now() - t2),
          detail: `${fileCount} files uploaded to storage nodes in parallel — no wallet prompt`,
        })
      } catch (e) {
        patchStep('upload', { status: 'error', error: String(e) })
        return
      }

      // ── Step 4: certify ──────────────────────────────────────────────────
      // certify() returns 1 Transaction batching all N certifications
      patchStep('certify', { status: 'running', detail: 'Waiting for wallet signature…' })
      const t3 = performance.now()
      const certifyTx = flow.certify()

      setWalletPromptCount(c => c + 1)  // about to prompt wallet

      let certifyDigest: string
      try {
        const result = await signAndExecute({ transaction: certifyTx })
        certifyDigest = result.digest
      } catch (e) {
        patchStep('certify', { status: 'error', error: `Wallet rejected or failed: ${e}` })
        return
      }

      patchStep('certify', {
        status: 'done',
        ms: Math.round(performance.now() - t3),
        detail: [
          `1 wallet prompt → 1 Transaction signed & executed`,
          `All ${fileCount} blob certification${fileCount > 1 ? 's' : ''} batched in a single PTB`,
          `Digest: ${certifyDigest}`,
        ].join('\n'),
      })

      // ── Step 5: list resulting files ─────────────────────────────────────
      patchStep('files', { status: 'running' })
      const t4 = performance.now()
      try {
        const listed = await flow.listFiles()
        patchStep('files', {
          status: 'done',
          ms: Math.round(performance.now() - t4),
          detail: listed
            .map((f, i) => `File ${i + 1}: blobId=${f.blobId}\n         objectId=${f.id}`)
            .join('\n'),
        })
      } catch (e) {
        patchStep('files', { status: 'error', error: String(e) })
      }

    } finally {
      setRunning(false)
    }
  }

  const allDone = results &&
    (['encode', 'register', 'upload', 'certify'] as const).every(k => results[k].status === 'done')

  const steps: {
    key: keyof FlowResults
    label: string
    wallet: boolean
    description: string
  }[] = [
    {
      key: 'encode',
      label: 'flow.encode()',
      wallet: false,
      description: 'WASM erasure-coding all files in parallel',
    },
    {
      key: 'register',
      label: 'flow.register() → sign → execute',
      wallet: true,
      description: `1 PTB batches all ${fileCount} blob registrations`,
    },
    {
      key: 'upload',
      label: 'flow.upload(digest)',
      wallet: false,
      description: 'Parallel HTTP uploads to Walrus storage nodes',
    },
    {
      key: 'certify',
      label: 'flow.certify() → sign → execute',
      wallet: true,
      description: `1 PTB batches all ${fileCount} blob certifications`,
    },
    {
      key: 'files',
      label: 'flow.listFiles()',
      wallet: false,
      description: 'Fetch resulting on-chain file objects',
    },
  ]

  return (
    <div className="min-h-screen bg-white py-10 px-4">
      <div className="max-w-2xl mx-auto space-y-7">

        {/* Header */}
        <div>
          <h1 className="text-3xl font-semibold text-gray-900 tracking-tight">
            writeFilesFlow Batching Test
          </h1>
          <p className="mt-2 text-sm text-gray-500 leading-relaxed">
            Real end-to-end test: sign transactions with your wallet and verify that{' '}
            <strong>N files always produce exactly 2 wallet prompts</strong> — not N×2.
          </p>
        </div>

        {/* Theory */}
        <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 font-mono text-xs leading-6 text-gray-700 space-y-0.5">
          <div className="text-gray-400">{'// expected for ' + fileCount + ' file' + (fileCount > 1 ? 's' : '')}</div>
          <div><span className="text-blue-600">encode()</span>   → no wallet &nbsp;&nbsp;&nbsp;<span className="text-gray-400">parallel WASM</span></div>
          <div><span className="text-purple-600">register()</span>→ <span className="text-purple-800 font-bold">wallet prompt #1</span> &nbsp;1 PTB, {fileCount} blob{fileCount > 1 ? 's' : ''}</div>
          <div><span className="text-blue-600">upload()</span>   → no wallet &nbsp;&nbsp;&nbsp;<span className="text-gray-400">parallel HTTP</span></div>
          <div><span className="text-purple-600">certify()</span> → <span className="text-purple-800 font-bold">wallet prompt #2</span> &nbsp;1 PTB, {fileCount} blob{fileCount > 1 ? 's' : ''}</div>
          <div className="text-green-700 pt-0.5 font-semibold">{'// 2 prompts total, proven on-chain'}</div>
        </div>

        {/* Wallet connect */}
        <div className="flex items-center justify-between border border-gray-200 rounded-xl p-4">
          <div>
            <div className="text-sm font-medium text-gray-900">Wallet</div>
            {account ? (
              <div className="text-xs text-gray-500 font-mono mt-0.5 truncate max-w-xs">
                {account.address}
              </div>
            ) : (
              <div className="text-xs text-gray-400 mt-0.5">Connect a Sui wallet to run the test</div>
            )}
          </div>
          <ConnectButton />
        </div>

        {/* File count */}
        <div className="space-y-2">
          <label className="text-sm font-medium text-gray-700">Number of files</label>
          <div className="flex gap-2">
            {FILE_COUNTS.map(n => (
              <button
                key={n}
                onClick={() => setFileCount(n)}
                disabled={running}
                className={`px-5 py-2 rounded-lg text-sm font-medium border transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                  fileCount === n
                    ? 'bg-gray-900 text-white border-gray-900'
                    : 'bg-white text-gray-700 border-gray-300 hover:border-gray-500'
                }`}
              >
                {n}
              </button>
            ))}
          </div>
          <p className="text-xs text-gray-400">Each file is 1 KB of deterministic test data</p>
        </div>

        {/* Run button */}
        <button
          onClick={runFlow}
          disabled={!account || running}
          className="w-full py-3.5 bg-gray-900 text-white rounded-lg hover:bg-gray-800 transition-colors font-medium disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {!account ? 'Connect wallet to run' : running ? (
            <span className="inline-flex items-center gap-2 justify-center">
              <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              Running… (wallet prompt count: {walletPromptCount})
            </span>
          ) : `Run Full Test — ${fileCount} file${fileCount > 1 ? 's' : ''}`}
        </button>

        {/* Results */}
        {results && (
          <div className="space-y-3">
            {/* Live wallet prompt counter */}
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider">Results</h2>
              <div className={`text-sm font-semibold px-3 py-1 rounded-full ${
                walletPromptCount === 0 ? 'bg-gray-100 text-gray-500'
                : walletPromptCount < 2   ? 'bg-purple-100 text-purple-700'
                : allDone                  ? 'bg-green-100 text-green-700'
                : 'bg-purple-100 text-purple-700'
              }`}>
                {walletPromptCount} / 2 wallet prompts
              </div>
            </div>

            {steps.map(({ key, label, wallet, description }) => {
              const step = results[key]
              return (
                <div key={key} className="border border-gray-200 rounded-xl p-4 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <StatusBadge status={step.status} />
                      <span className="font-mono text-sm font-medium text-gray-900 truncate">{label}</span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {wallet ? (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-purple-100 text-purple-700 border border-purple-200">
                          wallet
                        </span>
                      ) : (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-400 border border-gray-200">
                          no wallet
                        </span>
                      )}
                      {step.ms !== undefined && (
                        <span className="text-xs text-gray-400">{step.ms} ms</span>
                      )}
                    </div>
                  </div>
                  <p className="text-xs text-gray-400 ml-6">{description}</p>
                  {step.detail && (
                    <div className="ml-6 text-xs text-gray-700 bg-gray-50 rounded-lg p-2.5 font-mono whitespace-pre-line leading-5 border border-gray-100">
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
            <div className="text-green-800 font-semibold text-base">Theory confirmed on-chain ✓</div>
            <p className="text-sm text-green-700 leading-relaxed">
              <strong>{fileCount} files</strong> uploaded with exactly{' '}
              <strong>2 wallet prompts</strong> — one register PTB and one certify PTB,
              each batching all {fileCount} blob{fileCount > 1 ? 's' : ''} into a single Sui transaction.
            </p>
            <p className="text-xs text-green-600 mt-1">
              Both transaction digests are real, on-chain proofs. Try changing the file count
              and re-running — the wallet prompt count stays at 2.
            </p>
          </div>
        )}

        <p className="text-xs text-gray-400 text-center pb-4">
          Walrus testnet · {EPOCHS} epoch · files are 1 KB dummy data
        </p>
      </div>
    </div>
  )
}
