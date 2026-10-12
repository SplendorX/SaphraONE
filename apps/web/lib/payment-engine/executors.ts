export type ExecutionResult = {
  txHash?: string;
  transactionId?: string;
  status: "submitted" | "failed";
  error?: string;
};
