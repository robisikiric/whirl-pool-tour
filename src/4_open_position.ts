import {
  ComputeBudgetProgram,
  PublicKey,
} from "@solana/web3.js";
import {
  PriceMath,
  increaseLiquidityQuoteByInputTokenWithParams,
  TokenExtensionUtil,
  swapQuoteByOutputToken,
  IGNORE_CACHE,
  IncreaseLiquidityQuote
} from "@orca-so/whirlpools-sdk";
import {
  DecimalUtil,
  Percentage,
} from "@orca-so/common-sdk";
import Decimal from "decimal.js";
import {
  ctx,
  client,
  USDC,
  WSOL,
  minPriorityFeeLamports,
  maxPriorityFeeLamports,
  lookupTableAddress,
  MIN_BALANCE_SOL,
  MIN_BALANCE_USDC,
  MAIN_POOL_ID,
  SWAP_POOL_ID,
  CU_instruction,
  JITO_ix,
} from "./config";
import { BN } from "bn.js";
import {
  checkBalance,
  get_SOL_balance,
  get_USDC_balance,
  sleep,
  manualSend,
  jitoSend,
} from "./utils";
import { TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import base58 from "bs58";

async function open_position_SOL(amount_SOL: string, amount_USDC: string, price_low: Decimal, price_high: Decimal) {
  try {
    const wsol_amount = DecimalUtil.toBN(new Decimal(amount_SOL /* WSOL */), WSOL.decimals);
    const usdc_amount = DecimalUtil.toBN(new Decimal(amount_USDC /* USDC */), USDC.decimals);

    // Get current sol and usdc balance of wallet
    const current_SOL_balance = await get_SOL_balance(ctx.wallet.publicKey);
    const current_USDC_balance = await get_USDC_balance(ctx.wallet.publicKey);

    // Check if SOL or USDC balance is sufficient for the transaction
    if (current_SOL_balance.lt(wsol_amount.sub(MIN_BALANCE_SOL)) || current_USDC_balance.lt(usdc_amount.sub(MIN_BALANCE_USDC))) {
      throw "Insufficient SOL or USDC balance";
    }

    // Get Pool Information
    const whirlpool = await client.getPool(MAIN_POOL_ID);
    const swap_whirlpool = await client.getPool(SWAP_POOL_ID);
  
    // Get the current price of the pool
    const sqrt_price_x64 = whirlpool.getData().sqrtPrice;
    const price = PriceMath.sqrtPriceX64ToPrice(sqrt_price_x64, WSOL.decimals, USDC.decimals);
    console.log("price:", price.toFixed(USDC.decimals));
  
    // Set slippage
    const slippage = Percentage.fromFraction(25, 1000); // 2.5%
  
    // Adjust price range (not all prices can be set, only a limited number of prices are available for range specification)
    // (prices corresponding to InitializableTickIndex are available)
    const whirlpool_data = whirlpool.getData();
    const token_a = whirlpool.getTokenAInfo();
    const token_b = whirlpool.getTokenBInfo();

    // Calculate tick index for the low and high price
    const lower_tick_index = PriceMath.priceToInitializableTickIndex(price_low, token_a.decimals, token_b.decimals, whirlpool_data.tickSpacing);
    const higher_tick_index = PriceMath.priceToInitializableTickIndex(price_high, token_a.decimals, token_b.decimals, whirlpool_data.tickSpacing);

    // Get token extensionCtx
    const tokenExtensionCtx = await TokenExtensionUtil.buildTokenExtensionContext(ctx.fetcher, whirlpool_data);

    const total_balance_in_USDC = price.mul(amount_SOL).add(DecimalUtil.fromBN(usdc_amount, USDC.decimals));
    console.log("ratio: ", (whirlpool_data.tickCurrentIndex - lower_tick_index) / (higher_tick_index - lower_tick_index) * 100);
    
    const price_USDC = PriceMath.invertPrice(price, USDC.decimals, WSOL.decimals);
    const total_balance_in_WSOL = price_USDC.mul(amount_USDC).add(DecimalUtil.fromBN(wsol_amount, WSOL.decimals));
  
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
        tickLowerIndex: lower_tick_index,
        tickUpperIndex: higher_tick_index,
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
        tickLowerIndex: lower_tick_index,
        tickUpperIndex: higher_tick_index,
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
        tickLowerIndex: lower_tick_index,
        tickUpperIndex: higher_tick_index,
        // Input token and amount
        inputTokenMint: inputTokenMint,
        inputTokenAmount: inputTokenAmount,
        // Acceptable slippage
        slippageTolerance: slippage,
        // Get token info for TokenExtensions
        tokenExtensionCtx: tokenExtensionCtx,
      });
    }
  
    // Output the estimation
    console.log("WSOL max input:", DecimalUtil.fromBN(quote.tokenMaxA, token_a.decimals).toFixed(token_a.decimals));
    console.log("USDC max input:", DecimalUtil.fromBN(quote.tokenMaxB, token_b.decimals).toFixed(token_b.decimals));

    // Create a transaction
    const { tx: open_position_tx } = await whirlpool.openPositionWithMetadata(
      lower_tick_index,
      higher_tick_index,
      quote,
      ctx.wallet.publicKey,
      ctx.wallet.publicKey,
      undefined,
      TOKEN_2022_PROGRAM_ID
    );

    // Check if SOL or USDC balance is sufficient for the transaction
    if (current_SOL_balance.lt(quote.tokenMaxA)) { // when SOL balance is insufficient
      const swapQuote = await swapQuoteByOutputToken(
        swap_whirlpool,
        // Input token and amount
        WSOL.mint,
        quote.tokenEstA.sub(current_SOL_balance),
        slippage,
        ctx.program.programId,
        ctx.fetcher,
        IGNORE_CACHE,
      );

      const swapTx = await swap_whirlpool.swap(swapQuote);
      const swapInstruction = swapTx.compressIx(true);
      open_position_tx.prependInstruction(swapInstruction);
    }
    else if (current_USDC_balance.lt(quote.tokenMaxB)) { // when USDC balance is insufficient
      const swapQuote = await swapQuoteByOutputToken(
        swap_whirlpool,
        // Input token and amount
        USDC.mint,
        quote.tokenEstB.sub(current_USDC_balance),
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
      open_position_tx.prependInstruction(swapInstruction);
    }

    // Prepend CU instruction
    open_position_tx.prependInstruction({
      instructions: [
        ComputeBudgetProgram.setComputeUnitLimit({
          units: 230000,
        }),
        ComputeBudgetProgram.setComputeUnitPrice({
          microLamports: 200000,
        }),
      ],
      signers: [],
      cleanupInstructions: [],
    });

    // Add JITO instruction
    // open_position_tx.addInstruction(JITO_ix);

    // get the table from the cluster
    const lookupTableAccount = (await ctx.connection.getAddressLookupTable(lookupTableAddress)).value;
    // const latest_blockhash = await ctx.connection.getLatestBlockhash();

    // manual build
    const built = await open_position_tx.build({
      maxSupportedTransactionVersion: 0,
      lookupTableAccounts: [lookupTableAccount],
    });

    await manualSend(built);
  } catch (err) {
    console.log(`Error: ${err}`);
  }
}

open_position_SOL(
  "0",
  "300",
  new Decimal("240"),
  new Decimal("243"),
);
