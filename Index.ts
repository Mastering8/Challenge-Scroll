import { config as dotenv } from "dotenv";
import {
  createWalletClient,
  http,
  getContract,
  erc20Abi,
  parseUnits,
  maxUint256,
  publicActions,
  concat,
  numberToHex,
  size,
} from "viem";
import type { Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { scroll } from "viem/chains";
import { wethAbi } from "./abi/weth-abi";

// Load environment variables
dotenv();
const { PRIVATE_KEY, ZERO_EX_API_KEY, ALCHEMY_HTTP_TRANSPORT_URL } = process.env;

// Validate env vars
if (!PRIVATE_KEY) throw new Error("missing PRIVATE_KEY.");
if (!ZERO_EX_API_KEY) throw new Error("missing ZERO_EX_API_KEY.");
if (!ALCHEMY_HTTP_TRANSPORT_URL) throw new Error("missing ALCHEMY_HTTP_TRANSPORT_URL.");

// Setup headers
const headers = new Headers({
  "Content-Type": "application/json",
  "0x-api-key": ZERO_EX_API_KEY,
  "0x-version": "v2",
});

// Setup wallet client
const client = createWalletClient({
  account: privateKeyToAccount(`0x${PRIVATE_KEY}` as `0x${string}`),
  chain: scroll,
  transport: http(ALCHEMY_HTTP_TRANSPORT_URL),
}).extend(publicActions);

// Get addresses
const [address] = await client.getAddresses();

// Contracts
const weth = getContract({
  address: "0x5300000000000000000000000000000000000004",
  abi: wethAbi,
  client,
});
const wsteth = getContract({
  address: "0xf610A9dfB7C89644979b4A0f27063E9e7d7Cda32",
  abi: erc20Abi,
  client,
});

const main = async () => {
  // Specify sell amount
  const decimals = (await weth.read.decimals()) as number;
  const sellAmount = parseUnits("0.1", decimals);

  // 1. Fetch price
  const priceParams = new URLSearchParams({
    chainId: client.chain.id.toString(),
    sellToken: weth.address,
    buyToken: wsteth.address,
    sellAmount: sellAmount.toString(),
    taker: client.account.address,
    affiliateAddress: "YOUR_AFFILIATE_ADDRESS", // For monetization
    affiliateFeeBps: "100",  // Fee in bps (adjust as needed)
  });

  const priceResponse = await fetch(
    "https://api.0x.org/swap/permit2/price?" + priceParams.toString(),
    { headers }
  );

  const price = await priceResponse.json();
  console.log("Price fetched: ", price);

  // 1. Display Percentage Breakdown of Liquidity Sources
  if (price.route && price.route.fills) {
    const totalBps = 10000; // Total basis points
    console.log("Liquidity Sources Breakdown:");
    price.route.fills.forEach((fill: any) => {
      const percentage = (parseInt(fill.proportionBps) / totalBps) * 100;
      console.log(`${fill.source}: ${percentage}%`);
    });
  }

  // 2. Check allowance for Permit2
  if (price.issues?.allowance) {
    const { request } = await weth.simulate.approve([
      price.issues.allowance.spender,
      maxUint256,
    ]);
    const hash = await weth.write.approve(request.args);
    console.log("Permit2 approval granted.", await client.waitForTransactionReceipt({ hash }));
  }

  // 3. Fetch quote
  const quoteResponse = await fetch(
    "https://api.0x.org/swap/permit2/quote?" + priceParams.toString(),
    { headers }
  );

  const quote = await quoteResponse.json();
  console.log("Quote fetched: ", quote);

  // 4. Handle token buy/sell taxes (if applicable)
  if (quote.tokenMetadata?.buyToken?.buyTaxBps || quote.tokenMetadata?.sellToken?.sellTaxBps) {
    console.log("Buy Token Buy Tax:", (quote.tokenMetadata.buyToken.buyTaxBps / 10000) * 100, "%");
    console.log("Sell Token Sell Tax:", (quote.tokenMetadata.sellToken.sellTaxBps / 10000) * 100, "%");
  }

  // 5. Sign and send transaction
  if (quote.permit2?.eip712) {
    const signature = await client.signTypedData(quote.permit2.eip712);
    const sigLengthHex = numberToHex(size(signature), { signed: false, size: 32 });
    const transactionData = concat([quote.transaction.data, sigLengthHex, signature]);

    const nonce = await client.getTransactionCount({ address: client.account.address });
    const signedTransaction = await client.signTransaction({
      account: client.account,
      chain: client.chain,
      to: quote.transaction.to,
      data: transactionData,
      nonce,
    });

    const hash = await client.sendRawTransaction({ serializedTransaction: signedTransaction });
    console.log("Transaction hash:", hash);
  }
};

// Task 4: Display all liquidity sources on Scroll chain
const displayLiquiditySources = async () => {
  const sourcesResponse = await fetch(
    "https://api.0x.org/swap/v1/sources?chainId=" + client.chain.id,
    { headers }
  );
  
  const sourcesData = await sourcesResponse.json();
  const sources = sourcesData.sources.map((source: any) => source.name);

  console.log("Liquidity sources for Scroll chain:");
  sources.forEach((source: string) => console.log(`  ${source}`));
};

// Execute the main function and display liquidity sources
main().then(() => displayLiquiditySources());
