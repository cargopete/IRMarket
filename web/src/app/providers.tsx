"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WagmiProvider } from "wagmi";
import { config } from "@/lib/wagmi";
import { useState } from "react";

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 2000,
            refetchOnWindowFocus: false,
            // The public Monad testnet RPC rate-limits bursts of first-load reads (HTTP 429).
            // A single immediate retry dies to the same throttle and pins token-meta reads
            // at "???" until the user navigates; spaced retries let the reads recover in place.
            retry: 3,
            retryDelay: (attempt) => Math.min(500 * 2 ** attempt, 5000),
          },
        },
      }),
  );

  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        {children}
      </QueryClientProvider>
    </WagmiProvider>
  );
}