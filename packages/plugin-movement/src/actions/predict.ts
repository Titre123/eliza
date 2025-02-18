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
import { MOVEMENT_NETWORK_CONFIG, MOVEMENT_EXPLORER_URL } from "../constants";

// Updated content interface to include username
export interface PredictionMarketContent extends Content {
    marketQuestion: string;
    username: string;
}

function formatText(text: String) {
    return text.replace(/\s+/g, '_').toLocaleLowerCase();
}

function isPredictionMarketContent(content: unknown): content is PredictionMarketContent {
    elizaLogger.debug("Validating prediction market content:", content);
    return (
        typeof (content as PredictionMarketContent).marketQuestion === "string" &&
        typeof (content as PredictionMarketContent).username === "string"
    );
}

const predictionMarketTemplate = `You are processing a prediction market creation request. Extract the market question and username from the message.

Example requests and responses:

1. Twitter message (twitter username automatically available. username name is the one with the @. The name is after the @):
Input: "@eliza_bot Will BTC reach 100k in 2024?"
\`\`\`json
{
    "marketQuestion": "Will BTC reach 100k in 2024",
    "username": "{{twitterUsername}}"
}
\`\`\`

2. Eliza chat message (requires username specification):
Input: "Will BTC reach 100k in 2024? username:cryptotrader"
\`\`\`json
{
    "marketQuestion": "Will BTC reach 100k in 2024",
    "username": "cryptotrader"
}
\`\`\`

Rules:
1. Extract the market question exactly as provided
2. For Twitter messages, use the sender's Twitter username automatically
3. For Eliza chat, look for "username:" followed by the specified username
4. If no username is specified in Eliza chat, return "anonymous"
5. Include any time frames or specific conditions mentioned in the question
6. Remove any @mentions from the market question
7. Make sure you remove the question mark at the end of the questions

Recent messages:
{{recentMessages}}

Extract and return ONLY the following in a JSON block:
- marketQuestion: The prediction market question
- username: The username (from Twitter or specified in message)

Return ONLY the JSON block with these fields.`;

export default {
    name: "CREATE_PREDICTION_MARKET",
    similes: [
        // Direct Action Similes
        "NEW_PREDICTION_MARKET",
        "START_PREDICTION_MARKET",
        "CREATE_MARKET",
        "NEW_MARKET",
    
        // Technical/System Similes
        "MARKET_CREATION",
        "PREDICTION_PLATFORM_INIT",
        "FORECAST_MARKET_SETUP",
        "SPECULATIVE_MARKET_LAUNCH",
    
        // Domain-Specific Similes
        "CRYPTO_MARKET_CREATE",
        "FINANCIAL_PREDICTION_MARKET",
        "POLITICAL_FORECAST_MARKET",
        "SPORTS_PREDICTION_PLATFORM",
    
        // Generic Prediction Similes
        "OUTCOME_MARKET",
        "PROBABILITY_MARKET",
        "SPECULATION_PLATFORM",
        "PREDICTIVE_MARKET_INIT",
    
        // Event-Based Similes
        "ELECTION_MARKET",
        "TECHNOLOGY_FORECAST_MARKET",
        "ENTERTAINMENT_PREDICTION_PLATFORM",
        "GLOBAL_EVENT_MARKET"
    ],
    triggers: [
        // Political Predictions
        "will chief win",
        "predict election outcome",
        "who wins presidency",
        "chances of winning",
        "election prediction",
        "political race forecast",
     
        // Sports Predictions
        "will team win championship",
        "predict game result",
        "sports outcome prediction",
        "who wins super bowl",
        "tournament winner forecast",
        "predict match winner",
     
        // Financial/Crypto Predictions
        "will bitcoin reach",
        "cryptocurrency price prediction",
        "predict stock price",
        "ethereum forecast",
        "market trend prediction",
        "crypto price outlook",
     
        // Technology Predictions
        "will company release",
        "tech breakthrough prediction",
        "product launch forecast",
        "predict next innovation",
        "tech company outlook",
        "startup success chances",
     
        // Entertainment Predictions
        "will movie win oscar",
        "predict award winner",
        "who gets grammy",
        "entertainment industry forecast",
        "box office prediction",
     
        // Science/Research Predictions
        "breakthrough discovery chances",
        "predict research outcome",
        "scientific innovation forecast",
     
        // Global Events
        "predict global event",
        "geopolitical forecast",
        "international relations prediction",
     
        // Cultural/Social Predictions
        "social trend prediction",
        "cultural shift forecast",
        "predict popular movement",
     
        // Generalized Prediction Language
        "predict outcome of",
        "does x happen",
        "forecast for",
        "what are odds of",
        "likelihood of",
        "probability of",
        "chances that",
        "will x happen",
        "predict if",
        "forecast whether"
    ],
    shouldHandle: (message: Memory) => {
        const text = message.content?.text?.toLowerCase() || "";
        return (
            text.includes("prediction market") || 
            (text.includes("market") && text.includes("create")) ||
            text.includes("predict") ||
            text.includes("will") ||
            text.includes("chances") ||
            text.includes("odds")
        );
    },
    validate: async (_runtime: IAgentRuntime, message: Memory) => {
        elizaLogger.debug("Starting prediction market validation for user:", message.userId);
        elizaLogger.debug("Message text:", message.content?.text);
        
        // For Twitter messages
        if (message.context?.twitter) {
            return Boolean(message.context.twitter.username);
        }
        
        // For Eliza chat, check if username is specified in message
        const text = message.content?.text || "";
        return text.includes("username:") || true; // Allow anonymous users
    },
    priority: 1000,
    description: "Create a new prediction market both on-chain and in backend",
    handler: async (
        runtime: IAgentRuntime,
        message: Memory,
        state: State,
        _options: { [key: string]: unknown },
        callback?: HandlerCallback
    ): Promise<boolean> => {
        elizaLogger.debug("Starting CREATE_PREDICTION_MARKET handler...");

        try {
            const privateKey = runtime.getSetting("MOVEMENT_PRIVATE_KEY");
            const network = runtime.getSetting("MOVEMENT_NETWORK");
            console.log(network);
            const contractAddress = runtime.getSetting("PREDICTION_MARKET_CONTRACT");
            console.log(contractAddress);

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

            // Initialize or update state
            let currentState = state ? 
                await runtime.updateRecentMessageState(state) :
                (await runtime.composeState(message)) as State;

            // Generate prediction market content
            const content = await generateObjectDeprecated({
                runtime,
                context: composeContext({
                    state: currentState,
                    template: predictionMarketTemplate,
                }),
                modelClass: ModelClass.SMALL,
            });

            // Validate content
            if (!isPredictionMarketContent(content)) {
                throw new Error("Invalid prediction market content");
            }

            const creator = content.username || "anonymous";

            // Create market on blockchain
            const tx = await aptosClient.transaction.build.simple({
                sender: movementAccount.accountAddress.toStringLong(),
                data: {
                    function: `${contractAddress}::PredictionMarkets::create_market`,
                    typeArguments: [],
                    functionArguments: [
                        content.marketQuestion,
                        creator
                    ],
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
            
            elizaLogger.debug("Prediction market creation successful:", {
                hash: executedTransaction.hash,
                question: content.marketQuestion,
                creator: creator,
                explorerUrl,
            });

            if (callback) {
                callback({
                    text: `Successfully created prediction market!\nview market: https://prediction-bice.vercel.app/market/${formatText(content.marketQuestion)}\nView on Explorer: ${explorerUrl}`,
                    content: {
                        success: true,
                        hash: executedTransaction.hash,
                        marketQuestion: content.marketQuestion,
                        creator: creator,
                        explorerUrl,
                    },
                });
            }

            return true;
        } catch (error) {
            console.error("Error creating prediction market:", error);
            if (callback) {
                callback({
                    text: `Error creating prediction market: ${error.message}`,
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
                    text: "Will Bitcoin hit $100k in 2024? 🚀",
                },
            },
            {
                user: "{{user2}}",
                content: {
                    text: "Creating prediction market for Bitcoin price...",
                    action: "CREATE_PREDICTION_MARKET",
                },
            },
        ],
        [
            {
                user: "{{user1}}",
                content: {
                    text: "Predicting Ethereum's price after next halving 📈",
                },
            },
            {
                user: "{{user2}}",
                content: {
                    text: "Launching prediction market for Ethereum price...",
                    action: "CREATE_PREDICTION_MARKET",
                },
            },
        ],
        [
            {
                user: "{{user1}}",
                content: {
                    text: "Solana chances of flipping Ethereum this year?",
                },
            },
            {
                user: "{{user2}}",
                content: {
                    text: "Creating prediction market for Solana vs Ethereum...",
                    action: "CREATE_PREDICTION_MARKET",
                },
            },
        ],
        [
            {
                user: "{{user1}}",
                content: {
                    text: "Odds of Cardano reaching top 3 cryptocurrencies?",
                },
            },
            {
                user: "{{user2}}",
                content: {
                    text: "Setting up prediction market for Cardano ranking...",
                    action: "CREATE_PREDICTION_MARKET",
                },
            },
        ],
        [
            {
                user: "{{user1}}",
                content: {
                    text: "Will Base blockchain become a major L2 solution?",
                },
            },
            {
                user: "{{user2}}",
                content: {
                    text: "Creating prediction market for Base blockchain adoption...",
                    action: "CREATE_PREDICTION_MARKET",
                },
            },
        ],
        [
            {
                user: "{{user1}}",
                content: {
                    text: "Predict Binance's regulatory outcome in 2024",
                },
            },
            {
                user: "{{user2}}",
                content: {
                    text: "Launching prediction market for Binance regulations...",
                    action: "CREATE_PREDICTION_MARKET",
                },
            },
        ],
        [
            {
                user: "{{user1}}",
                content: {
                    text: "Chances of Ripple winning SEC lawsuit completely?",
                },
            },
            {
                user: "{{user2}}",
                content: {
                    text: "Creating prediction market for Ripple legal case...",
                    action: "CREATE_PREDICTION_MARKET",
                },
            },
        ],
        [
            {
                user: "{{user1}}",
                content: {
                    text: "Will Polygon merge with another blockchain ecosystem?",
                },
            },
            {
                user: "{{user2}}",
                content: {
                    text: "Setting up prediction market for Polygon ecosystem...",
                    action: "CREATE_PREDICTION_MARKET",
                },
            },
        ],
        [
            {
                user: "{{user1}}",
                content: {
                    text: "Predicting market cap of emerging altcoins",
                },
            },
            {
                user: "{{user2}}",
                content: {
                    text: "Launching prediction market for altcoin market cap...",
                    action: "CREATE_PREDICTION_MARKET",
                },
            },
        ],
        [
            {
                user: "{{user1}}",
                content: {
                    text: "Will AI crypto projects dominate next bull run?",
                },
            },
            {
                user: "{{user2}}",
                content: {
                    text: "Creating prediction market for AI crypto trends...",
                    action: "CREATE_PREDICTION_MARKET",
                },
            },
        ],
        [
            {
                user: "{{user1}}",
                content: {
                    text: "Odds of Bitcoin ETF full mainstream adoption",
                },
            },
            {
                user: "{{user2}}",
                content: {
                    text: "Setting up prediction market for Bitcoin ETF...",
                    action: "CREATE_PREDICTION_MARKET",
                },
            },
        ],
        [
            {
                user: "{{user1}}",
                content: {
                    text: "Predicting Tether's market dynamics in 2024",
                },
            },
            {
                user: "{{user2}}",
                content: {
                    text: "Launching prediction market for Tether...",
                    action: "CREATE_PREDICTION_MARKET",
                },
            },
        ],
        [
            {
                user: "{{user1}}",
                content: {
                    text: "Will decentralized exchanges overtake centralized ones?",
                },
            },
            {
                user: "{{user2}}",
                content: {
                    text: "Creating prediction market for DEX vs CEX...",
                    action: "CREATE_PREDICTION_MARKET",
                },
            },
        ],
        [
            {
                user: "{{user1}}",
                content: {
                    text: "Predict Layer 2 blockchain market leadership",
                },
            },
            {
                user: "{{user2}}",
                content: {
                    text: "Setting up prediction market for Layer 2 blockchain...",
                    action: "CREATE_PREDICTION_MARKET",
                },
            },
        ],
        [
            {
                user: "{{user1}}",
                content: {
                    text: "Chances of major crypto regulation changes?",
                },
            },
            {
                user: "{{user2}}",
                content: {
                    text: "Creating prediction market for crypto regulations...",
                    action: "CREATE_PREDICTION_MARKET",
                },
            },
        ],
        [
            {
                user: "{{user1}}",
                content: {
                    text: "Will Web3 gaming platforms gain significant traction?",
                },
            },
            {
                user: "{{user2}}",
                content: {
                    text: "Launching prediction market for Web3 gaming...",
                    action: "CREATE_PREDICTION_MARKET",
                },
            },
        ],
        [
            {
                user: "{{user1}}",
                content: {
                    text: "Predicting DeFi total value locked trends",
                },
            },
            {
                user: "{{user2}}",
                content: {
                    text: "Creating prediction market for DeFi TVL...",
                    action: "CREATE_PREDICTION_MARKET",
                },
            },
        ],
        [
            {
                user: "{{user1}}",
                content: {
                    text: "Odds of another major crypto exchange collapse?",
                },
            },
            {
                user: "{{user2}}",
                content: {
                    text: "Setting up prediction market for crypto exchange risk...",
                    action: "CREATE_PREDICTION_MARKET",
                },
            },
        ],
        [
            {
                user: "{{user1}}",
                content: {
                    text: "Will quantum computing impact blockchain security?",
                },
            },
            {
                user: "{{user2}}",
                content: {
                    text: "Creating prediction market for quantum blockchain impact...",
                    action: "CREATE_PREDICTION_MARKET",
                },
            },
        ],
        [
            {
                user: "{{user1}}",
                content: {
                    text: "Predicting next big blockchain innovation?",
                },
            },
            {
                user: "{{user2}}",
                content: {
                    text: "Launching prediction market for blockchain innovation...",
                    action: "CREATE_PREDICTION_MARKET",
                },
            },
        ]
     ] as ActionExample[][],
} as Action;