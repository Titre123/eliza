import type { Plugin } from "@elizaos/core";
import transferToken from "./actions/transfer";
import call_Function from "./actions/call_func";
import Prediction from "./actions/predict";
import { WalletProvider, walletProvider } from "./providers/wallet";

export { WalletProvider, transferToken as TransferMovementToken };

export const movementPlugin: Plugin = {
    name: "movement",
    description: "Movement Network Plugin for Eliza",
    actions: [transferToken, call_Function, Prediction],
    evaluators: [],
    providers: [walletProvider],
};

export default movementPlugin;
