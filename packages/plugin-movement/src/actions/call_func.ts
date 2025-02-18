import { elizaLogger } from "@elizaos/core";
import {
    type ActionExample,
    type Content,
    type HandlerCallback,
    type IAgentRuntime,
    type Memory,
    ModelClass,
    type State,
    type Action,
} from "@elizaos/core";
import { composeContext } from "@elizaos/core";
import { generateObjectDeprecated } from "@elizaos/core";
import {
    Account,
    Aptos,
    AptosConfig,
    Ed25519PrivateKey,
    Network,
    PrivateKey,
    PrivateKeyVariants,
} from "@aptos-labs/ts-sdk";
import { walletProvider } from "../providers/wallet";
import {
    MOVEMENT_NETWORK_CONFIG,
    MOVEMENT_EXPLORER_URL,
} from "../constants";

export interface ContractCallContent extends Content {
    contractAddress: string;
    module: string;
    function: string;
    arguments: [];
}

function isContractCallContent(content: unknown): content is ContractCallContent {
    elizaLogger.debug("Validating contract call content:", content);
    return (
        typeof (content as ContractCallContent).contractAddress === "string" &&
        typeof (content as ContractCallContent).module === "string" &&
        typeof (content as ContractCallContent).function === "string" &&
        Array.isArray((content as ContractCallContent).arguments)
    );
}

const contractCallTemplate = `You are processing a smart contract function call request. Extract the contract address, module name, function name, and arguments from the message.

Example request: "call the function 0x123::calculator::add with arg1 as 4, arg2 as 5"
Example response:
\`\`\`json
{
    "contractAddress": "0x123",
    "module": "calculator",
    "function": "add",
    "arguments": [4, 5]
}
\`\`\`

Rules:
1. The contract address always starts with "0x"
2. Extract the module and function names exactly as provided
3. Convert numeric arguments to numbers, keep strings as strings
4. Return exact values found in the message

Recent messages:
{{recentMessages}}

Extract and return ONLY the following in a JSON block:
- contractAddress: The contract address starting with 0x
- module: The module name
- function: The function name
- arguments: Array of arguments in order

Return ONLY the JSON block with these fields.`;

export default {
    name: "CALL_CONTRACT",
    similes: [
        "EXECUTE_FUNCTION",
        "CALL_FUNCTION",
        "RUN_FUNCTION",
        "TEST_CONTRACT",
    ],
    triggers: [
        "call contract",
        "execute function",
        "call function",
        "test contract",
        "run function",
    ],
    shouldHandle: (message: Memory) => {
        const text = message.content?.text?.toLowerCase() || "";
        return (
            (text.includes("call") || text.includes("execute") || text.includes("run")) &&
            text.includes("0x")
        );
    },
    validate: async (_runtime: IAgentRuntime, message: Memory) => {
        elizaLogger.debug(
            "Starting contract call validation for user:",
            message.userId
        );
        elizaLogger.debug("Message text:", message.content?.text);
        return true;
    },
    priority: 1000,
    description: "Call a smart contract function with specified arguments",
    handler: async (
        runtime: IAgentRuntime,
        message: Memory,
        state: State,
        _options: { [key: string]: unknown },
        callback?: HandlerCallback
    ): Promise<boolean> => {
        elizaLogger.debug("Starting CALL_CONTRACT handler...");
        elizaLogger.debug("Message:", {
            text: message.content?.text,
            userId: message.userId,
            action: message.content?.action,
        });

        try {
            const privateKey = runtime.getSetting("MOVEMENT_PRIVATE_KEY");
            const network = runtime.getSetting("MOVEMENT_NETWORK");

            const movementAccount = Account.fromPrivateKey({
                privateKey: new Ed25519PrivateKey(
                    PrivateKey.formatPrivateKey(
                        privateKey,
                        PrivateKeyVariants.Ed25519
                    )
                ),
            });

            const aptosClient = new Aptos(
                new AptosConfig({
                    network: Network.CUSTOM,
                    fullnode: MOVEMENT_NETWORK_CONFIG[network].fullnode,
                })
            );

            const walletInfo = await walletProvider.get(
                runtime,
                message,
                state
            );
            state.walletInfo = walletInfo;

            // Initialize or update state
            let currentState: State;
            if (!state) {
                currentState = (await runtime.composeState(message)) as State;
            } else {
                currentState = await runtime.updateRecentMessageState(state);
            }

            // Compose contract call context
            const contractCallContext = composeContext({
                state: currentState,
                template: contractCallTemplate,
            });

            // Generate contract call content
            const content = await generateObjectDeprecated({
                runtime,
                context: contractCallContext,
                modelClass: ModelClass.SMALL,
            });

            // Validate contract call content
            if (!isContractCallContent(content)) {
                console.error("Invalid content for CALL_CONTRACT action.");
                if (callback) {
                    callback({
                        text: "Unable to process contract call request. Invalid content provided.",
                        content: { error: "Invalid contract call content" },
                    });
                }
                return false;
            }

            const tx = await aptosClient.transaction.build.simple({
                sender: movementAccount.accountAddress.toStringLong(),
                data: {
                    function: `${content.contractAddress}::${content.module}::${content.function}`,
                    typeArguments: [],
                    functionArguments: [...content.arguments],
                },
            });

            const committedTransaction = await aptosClient.signAndSubmitTransaction({
                signer: movementAccount,
                transaction: tx,
            });

            const executedTransaction = await aptosClient.waitForTransaction({
                transactionHash: committedTransaction.hash,
            });

            const explorerUrl = `${MOVEMENT_EXPLORER_URL}/${executedTransaction.hash}?network=${MOVEMENT_NETWORK_CONFIG[network].explorerNetwork}`;
            elizaLogger.debug("Contract call successful:", {
                hash: executedTransaction.hash,
                function: `${content.contractAddress}::${content.module}::${content.function}`,
                arguments: content.arguments,
                explorerUrl,
            });

            if (callback) {
                callback({
                    text: `Successfully called ${content.contractAddress}::${content.module}::${content.function}\nTransaction: ${executedTransaction.hash}\nView on Explorer: ${explorerUrl}`,
                    content: {
                        success: true,
                        hash: executedTransaction.hash,
                        contractAddress: content.contractAddress,
                        module: content.module,
                        function: content.function,
                        arguments: content.arguments,
                        explorerUrl,
                    },
                });
            }

            return true;
        } catch (error) {
            console.error("Error during contract call:", error);
            if (callback) {
                callback({
                    text: `Error calling contract function: ${error.message}`,
                    content: { error: error.message },
                });
            }
            return false;
        }
    },

    examples: [
        [
            {
                user: "{{user1}}",
                content: {
                    text: "call the 0x123::calculator::add with arg1 as 4, arg2 as 5",
                },
            },
            {
                user: "{{user2}}",
                content: {
                    text: "Processing contract function call...",
                    action: "CALL_CONTRACT",
                },
            },
        ],
        [
            {
                user: "{{user1}}",
                content: {
                    text: "execute 0x123::module::function with the following arg1 as 4, arg2 as 5, arg3 as Paul",
                },
            },
            {
                user: "{{user2}}",
                content: {
                    text: "Executing contract function...",
                    action: "CALL_CONTRACT",
                },
            },
        ],
    ] as ActionExample[][],
} as Action;