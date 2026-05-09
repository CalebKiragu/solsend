import { useMemo } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { AnchorProvider } from "@coral-xyz/anchor";
import { SolSendEscrowSDK } from "@/lib/solpayEscrow";

export function useEscrowSDK(): SolSendEscrowSDK | null {
  const { connection } = useConnection();
  const { publicKey, signTransaction, signAllTransactions } = useWallet();

  const sdk = useMemo(() => {
    if (!publicKey || !signTransaction || !signAllTransactions) return null;

    const provider = new AnchorProvider(
      connection,
      { publicKey, signTransaction, signAllTransactions } as any,
      { commitment: "confirmed" }
    );

    return new SolSendEscrowSDK(provider);
  }, [connection, publicKey, signTransaction, signAllTransactions]);

  return sdk;
}