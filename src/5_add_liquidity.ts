import { ComputeBudgetProgram, PublicKey } from "@solana/web3.js";
import {
  increaseLiquidityQuoteByInputTokenWithParams,
  TokenExtensionUtil,
  swapQuoteByOutputToken,
  IGNORE_CACHE,
  PriceMath,
  IncreaseLiquidityQuote,
} from "@orca-so/whirlpools-sdk";
import {
  DecimalUtil,
  Percentage,
} from "@orca-so/common-sdk";
import {
  ctx,
  client,
  USDC,
  WSOL,
  MIN_BALANCE_SOL,
  MIN_BALANCE_USDC,
  MAIN_POOL_ID,
  SWAP_POOL_ID,
  CU_instruction,
  lookupTableAddress,
} from "./config";
import { BN } from "bn.js";
import {
  get_SOL_balance,
  get_USDC_balance,
  manualSend,
} from "./utils";

export async function add_liquidity(position_id: PublicKey, amount_SOL: string, amount_USDC: string) {
  try {
    const position = await client.getPosition(position_id);
    const positionData = position.getData();

    // const input_SOL_amount = DecimalUtil.toBN(new Decimal(amount_SOL /* WSOL */), WSOL.decimals);
    // const input_USDC_amount = DecimalUtil.toBN(new Decimal(amount_USDC /* USDC */), USDC.decimals);

    // Get current sol and usdc balance of wallet
    const current_SOL_balance = await get_SOL_balance(ctx.wallet.publicKey);
    const current_USDC_balance = await get_USDC_balance(ctx.wallet.publicKey);

    const input_SOL_amount = current_SOL_balance.sub(MIN_BALANCE_SOL);
    const input_USDC_amount = current_USDC_balance.sub(MIN_BALANCE_USDC);

    // Get the pool to which the position belongs
    const whirlpool = await client.getPool(MAIN_POOL_ID);
    const swap_whirlpool = await client.getPool(SWAP_POOL_ID);

    // Get the current price of the pool
    const sqrt_price_x64 = whirlpool.getData().sqrtPrice;
    const price = PriceMath.sqrtPriceX64ToPrice(sqrt_price_x64, WSOL.decimals, USDC.decimals);
    console.log("price:", price.toFixed(USDC.decimals));

    // Set slippage
    const slippage = Percentage.fromFraction(100, 1000); // 2.5%

    // Adjust price range (not all prices can be set, only a limited number of prices are available for range specification)
    // (prices corresponding to InitializableTickIndex are available)
    const whirlpool_data = whirlpool.getData();
    const token_a = whirlpool.getTokenAInfo();
    const token_b = whirlpool.getTokenBInfo();

    // Calculate tick index for the low and high price
    const lower_tick_index = positionData.tickLowerIndex;
    const higher_tick_index = positionData.tickUpperIndex;

    // Get token extensionCtx
    const tokenExtensionCtx = await TokenExtensionUtil.buildTokenExtensionContext(ctx.fetcher, whirlpool_data);

    const total_balance_in_USDC = price.mul(DecimalUtil.fromBN(input_SOL_amount, WSOL.decimals)).add(DecimalUtil.fromBN(input_USDC_amount, USDC.decimals));
    console.log("usdc ratio: ", whirlpool_data.tickCurrentIndex > lower_tick_index ? (whirlpool_data.tickCurrentIndex - lower_tick_index) / (higher_tick_index - lower_tick_index) * 100 : 0);

    const price_USDC = PriceMath.invertPrice(price, USDC.decimals, WSOL.decimals);
    const total_balance_in_WSOL = price_USDC.mul(DecimalUtil.fromBN(input_USDC_amount, USDC.decimals)).add(DecimalUtil.fromBN(input_SOL_amount, WSOL.decimals));

    let quote: IncreaseLiquidityQuote;
    let inputTokenMint: PublicKey;
    let inputTokenAmount = new BN(0);
  
    if (whirlpool_data.tickCurrentIndex < lower_tick_index) { // if position is higher than price range
      console.log("price above");
      inputTokenMint = WSOL.mint;
      inputTokenAmount = DecimalUtil.toBN(total_balance_in_WSOL, WSOL.decimals);
      quote = increaseLiquidityQuoteByInputTokenWithParams({
        // Pass the pool definition and state
        tokenMintA: token_a.mint,
        tokenMintB: token_b.mint,
        sqrtPrice: whirlpool_data.sqrtPrice,
        tickCurrentIndex: whirlpool_data.tickCurrentIndex,
        // Price range
        tickLowerIndex: positionData.tickLowerIndex,
        tickUpperIndex: positionData.tickUpperIndex,
        // Input token and amount
        inputTokenMint: inputTokenMint,
        inputTokenAmount: inputTokenAmount,
        // Acceptable slippage
        slippageTolerance: slippage,
        // Get token info for TokenExtensions
        tokenExtensionCtx: tokenExtensionCtx,
      });
    }
    else if (whirlpool_data.tickCurrentIndex < higher_tick_index) { // if position is in price range
      console.log("price in");
      const deposit_amount_USDC = total_balance_in_USDC.mul(whirlpool_data.tickCurrentIndex - lower_tick_index).div(higher_tick_index - lower_tick_index);
      inputTokenMint = USDC.mint;
      inputTokenAmount = DecimalUtil.toBN(deposit_amount_USDC, USDC.decimals);
      quote = increaseLiquidityQuoteByInputTokenWithParams({
        // Pass the pool definition and state
        tokenMintA: token_a.mint,
        tokenMintB: token_b.mint,
        sqrtPrice: whirlpool_data.sqrtPrice,
        tickCurrentIndex: whirlpool_data.tickCurrentIndex,
        // Price range
        tickLowerIndex: positionData.tickLowerIndex,
        tickUpperIndex: positionData.tickUpperIndex,
        // Input token and amount
        inputTokenMint: inputTokenMint,
        inputTokenAmount: inputTokenAmount,
        // Acceptable slippage
        slippageTolerance: slippage,
        // Get token info for TokenExtensions
        tokenExtensionCtx: tokenExtensionCtx,
      });
    }
    else { // if position is lower than price range
      console.log("price below");
      inputTokenMint = USDC.mint;
      inputTokenAmount = DecimalUtil.toBN(total_balance_in_USDC, USDC.decimals);
      quote = increaseLiquidityQuoteByInputTokenWithParams({
        // Pass the pool definition and state
        tokenMintA: token_a.mint,
        tokenMintB: token_b.mint,
        sqrtPrice: whirlpool_data.sqrtPrice,
        tickCurrentIndex: whirlpool_data.tickCurrentIndex,
        // Price range
        tickLowerIndex: positionData.tickLowerIndex,
        tickUpperIndex: positionData.tickUpperIndex,
        // Input token and amount
        inputTokenMint: inputTokenMint,
        inputTokenAmount: inputTokenAmount,
        // Acceptable slippage
        slippageTolerance: slippage,
        // Get token info for TokenExtensions
        tokenExtensionCtx: tokenExtensionCtx,
      });
    }
  
    console.log("SOL max input:", DecimalUtil.fromBN(quote.tokenMaxA, token_a.decimals).toFixed(token_a.decimals));
    console.log("USDC max input:", DecimalUtil.fromBN(quote.tokenMaxB, token_b.decimals).toFixed(token_b.decimals));

    // Create a transaction
    const increase_liquidity_tx = await position.increaseLiquidity(quote);

    // Check if SOL or USDC balance is sufficient for the transaction
    if (input_SOL_amount.lt(quote.tokenMaxA)) { // when SOL balance is insufficient
      const swapQuote = await swapQuoteByOutputToken(
        swap_whirlpool,
        // Input token and amount
        WSOL.mint,
        quote.tokenEstA.sub(input_SOL_amount),
        slippage,
        ctx.program.programId,
        ctx.fetcher,
        IGNORE_CACHE,
      );

      const swapTx = await swap_whirlpool.swap(swapQuote);
      const swapInstruction = swapTx.compressIx(true);
      increase_liquidity_tx.prependInstruction(swapInstruction);
    }
    else if (input_USDC_amount.lt(quote.tokenMaxB)) { // when USDC balance is insufficient
      const swapQuote = await swapQuoteByOutputToken(
        swap_whirlpool,
        // Input token and amount
        USDC.mint,
        quote.tokenEstB.sub(input_USDC_amount),
        slippage,
        ctx.program.programId,
        ctx.fetcher,
        IGNORE_CACHE,
      );

      // Output the estimation
      console.log("estimatedAmountIn:", DecimalUtil.fromBN(swapQuote.estimatedAmountIn, WSOL.decimals).toString(), "WSOL");
      console.log("estimatedAmountOut:", DecimalUtil.fromBN(swapQuote.estimatedAmountOut, USDC.decimals).toString(), "USDC");

      const swapTx = await swap_whirlpool.swap(swapQuote);
      const swapInstruction = swapTx.compressIx(true);
      increase_liquidity_tx.prependInstruction(swapInstruction);
    }

    increase_liquidity_tx.prependInstruction({
      instructions: [
        ComputeBudgetProgram.setComputeUnitLimit({
          units: 120000,
        }),
        ComputeBudgetProgram.setComputeUnitPrice({
          microLamports: 200000,
        }),
      ],
      signers: [],
      cleanupInstructions: [],
    });

     // get the table from the cluster
     const lookupTableAccount = (await ctx.connection.getAddressLookupTable(lookupTableAddress)).value;

    // manual build
    const built = await increase_liquidity_tx.build({
      maxSupportedTransactionVersion: 0,
      lookupTableAccounts: [lookupTableAccount],
    });

    manualSend(built);
  } catch (err) {
    console.log(`Error: ${err}`);
  }
}

// add_liquidity(
//   new PublicKey("8xvC86wySULNhBqd2pXeBGwdvEuwnu94F3boaEGNzWNM"),
//   "0.1",
//   "0"
// );
