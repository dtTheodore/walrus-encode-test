'use client'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { SuiClientProvider, WalletProvider } from '@mysten/dapp-kit'
import { getFullnodeUrl } from '@mysten/sui/client'
import { type ReactNode } from 'react'

const queryClient = new QueryClient()

// dapp-kit only needs the base Sui client for wallet signing + waitForTransaction.
// Walrus-specific operations use a separate client created in page.tsx.
const networks = {
  testnet: { url: getFullnodeUrl('testnet'), network: 'testnet' as const },
}

export function Providers({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <SuiClientProvider networks={networks} defaultNetwork="testnet">
        <WalletProvider autoConnect>
          {children}
        </WalletProvider>
      </SuiClientProvider>
    </QueryClientProvider>
  )
}
