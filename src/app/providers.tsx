'use client'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useState } from 'react'
import { Toaster as SonnerToaster } from 'sonner'

export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(() => new QueryClient({
    defaultOptions: {
      queries: { retry: 1, staleTime: 10_000, refetchOnWindowFocus: false },
    },
  }))
  return (
    <QueryClientProvider client={client}>
      {children}
      <SonnerToaster position="top-center" richColors closeButton />
    </QueryClientProvider>
  )
}
