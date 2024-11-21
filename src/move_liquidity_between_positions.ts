import { ComputeBudgetProgram, PublicKey } from "@solana/web3.js";
import {
  Percentage,
  DecimalUtil,
} from "@orca-so/common-sdk";
import {
  decreaseLiquidityQuoteByLiquidityWithParams,
  increaseLiquidityQuoteByInputTokenWithParams,
  swapQuoteByOutputToken,
  TokenExtensionUtil,
  PriceMath,
  IGNORE_CACHE,
  IncreaseLiquidityQuote,
} from "@orca-so/whirlpools-sdk";
import {
  ctx,
  client,
  MAIN_POOL_ID,
  WSOL,
  USDC,
  SWAP_POOL_ID,
  lookupTableAddress,
  MIN_BALANCE_SOL,
  MIN_BALANCE_USDC,
} from "./config";
import { get_SOL_balance, get_USDC_balance, manualSend } from "./utils";
import { BN } from "bn.js";

export const move_liquidity_between_positions = async (cur_pos: PublicKey, next_pos: PublicKey) => {
  try {
    const positions = await client.getPositions([cur_pos, next_pos]);
    const cur_position = positions[cur_pos.toBase58()];
    const next_position = positions[next_pos.toBase58()];

    // Get current sol and usdc balance of wallet
    const current_SOL_balance = await get_SOL_balance(ctx.wallet.publicKey);
    const current_USDC_balance = await get_USDC_balance(ctx.wallet.publicKey);

    // Get the pool to which the position belongs
    const main_whirlpool = await client.getPool(MAIN_POOL_ID, IGNORE_CACHE);
    const swap_whirlpool = await client.getPool(SWAP_POOL_ID, IGNORE_CACHE);
    
    // Calculate tick index for the low and high price
    const lower_tick_index = next_position.getData().tickLowerIndex;
    const higher_tick_index = next_position.getData().tickUpperIndex;

    // Set slippage as 2.5%
    const slippage = Percentage.fromFraction(25, 1000);

    const main_whirlpool_data = main_whirlpool.getData();
    const cur_post_price = PriceMath.sqrtPriceX64ToPrice(main_whirlpool_data.sqrtPrice, WSOL.decimals, USDC.decimals);
    const mainTokenExtensionCtx = await TokenExtensionUtil.buildTokenExtensionContext(ctx.fetcher, main_whirlpool_data);

    const remove_quote = decreaseLiquidityQuoteByLiquidityWithParams({
      // Pass the pool state as is
      sqrtPrice: main_whirlpool_data.sqrtPrice,
      tickCurrentIndex: main_whirlpool_data.tickCurrentIndex,
      // Pass the price range of the position as is
      tickLowerIndex: cur_position.getData().tickLowerIndex,
      tickUpperIndex: cur_position.getData().tickUpperIndex,
      // Liquidity to be withdrawn
      liquidity: cur_position.getData().liquidity,
      // Acceptable slippage
      slippageTolerance: Percentage.fromFraction(0, 1000),
      // Get token info for TokenExtensions
      tokenExtensionCtx: mainTokenExtensionCtx,
    });

    console.log(`WSOL out: ${DecimalUtil.fromBN(remove_quote.tokenEstA, WSOL.decimals)}`);
    console.log(`USDC out: ${DecimalUtil.fromBN(remove_quote.tokenEstB, USDC.decimals)}`);

    // Calculate maximum amount to add for both tokens
    const input_SOL_amount = remove_quote.tokenEstA.add(current_SOL_balance).sub(MIN_BALANCE_SOL);
    const input_USDC_amount = remove_quote.tokenEstB.add(current_USDC_balance).sub(MIN_BALANCE_USDC);

    console.log(`SOL in: ${DecimalUtil.fromBN(input_SOL_amount, WSOL.decimals)}`);
    console.log(`USDC in: ${DecimalUtil.fromBN(input_USDC_amount, WSOL.decimals)}`);

    // Create a transaction
    const decrease_liquidity_tx = await cur_position.decreaseLiquidity(remove_quote);

    const total_balance_in_USDC = cur_post_price
      .mul(DecimalUtil.fromBN(input_SOL_amount, WSOL.decimals))
      .add(DecimalUtil.fromBN(input_USDC_amount, USDC.decimals));
    const price_USDC = PriceMath.invertPrice(cur_post_price, USDC.decimals, WSOL.decimals);
    const total_balance_in_WSOL = price_USDC
      .mul(DecimalUtil.fromBN(input_USDC_amount, USDC.decimals))
      .add(DecimalUtil.fromBN(input_SOL_amount, WSOL.decimals));

    let add_quote: IncreaseLiquidityQuote;
    let inputTokenMint: PublicKey;
    let inputTokenAmount = new BN(0);

    if (main_whirlpool_data.tickCurrentIndex < lower_tick_index) { // if position is higher than price range
      console.log("price above");
      inputTokenMint = WSOL.mint;
      inputTokenAmount = DecimalUtil.toBN(total_balance_in_WSOL, WSOL.decimals);
      add_quote = increaseLiquidityQuoteByInputTokenWithParams({
        // Pass the pool definition and state
        tokenMintA: WSOL.mint,
        tokenMintB: USDC.mint,
        sqrtPrice: main_whirlpool_data.sqrtPrice,
        tickCurrentIndex: main_whirlpool_data.tickCurrentIndex,
        // Price range
        tickLowerIndex: lower_tick_index,
        tickUpperIndex: higher_tick_index,
        // Input token and amount
        inputTokenMint: inputTokenMint,
        inputTokenAmount: inputTokenAmount,
        // Acceptable slippage
        slippageTolerance: slippage,
        // Get token info for TokenExtensions
        tokenExtensionCtx: mainTokenExtensionCtx,
      });
    }
    else if (main_whirlpool_data.tickCurrentIndex < higher_tick_index) { // if position is in price range
      console.log("price in");
      if (cur_position.getData().tickLowerIndex < next_position.getData().tickLowerIndex) {
        console.log("from lower to upper");
        const deposit_amount_USDC = total_balance_in_USDC.mul(main_whirlpool_data.tickCurrentIndex - lower_tick_index).div(higher_tick_index - lower_tick_index);
        inputTokenMint = USDC.mint;
        inputTokenAmount = DecimalUtil.toBN(deposit_amount_USDC, USDC.decimals);
        add_quote = increaseLiquidityQuoteByInputTokenWithParams({
          // Pass the pool definition and state
          tokenMintA: WSOL.mint,
          tokenMintB: USDC.mint,
          sqrtPrice: main_whirlpool_data.sqrtPrice,
          tickCurrentIndex: main_whirlpool_data.tickCurrentIndex,
          // Price range
          tickLowerIndex: lower_tick_index,
          tickUpperIndex: higher_tick_index,
          // Input token and amount
          inputTokenMint: inputTokenMint,
          inputTokenAmount: inputTokenAmount,
          // Acceptable slippage
          slippageTolerance: slippage,
          // Get token info for TokenExtensions
          tokenExtensionCtx: mainTokenExtensionCtx,
        });
      }
      else {
        console.log("from upper to lower");
        const deposit_amount_WSOL = total_balance_in_WSOL.mul(higher_tick_index - main_whirlpool_data.tickCurrentIndex).div(higher_tick_index - lower_tick_index);
        inputTokenMint = WSOL.mint;
        inputTokenAmount = DecimalUtil.toBN(deposit_amount_WSOL, WSOL.decimals);
        add_quote = increaseLiquidityQuoteByInputTokenWithParams({
          // Pass the pool definition and state
          tokenMintA: WSOL.mint,
          tokenMintB: USDC.mint,
          sqrtPrice: main_whirlpool_data.sqrtPrice,
          tickCurrentIndex: main_whirlpool_data.tickCurrentIndex,
          // Price range
          tickLowerIndex: lower_tick_index,
          tickUpperIndex: higher_tick_index,
          // Input token and amount
          inputTokenMint: inputTokenMint,
          inputTokenAmount: inputTokenAmount,
          // Acceptable slippage
          slippageTolerance: slippage,
          // Get token info for TokenExtensions
          tokenExtensionCtx: mainTokenExtensionCtx,
        });
      }
    }
    else { // if position is lower than price range
      console.log("price below");
      inputTokenMint = USDC.mint;
      inputTokenAmount = DecimalUtil.toBN(total_balance_in_USDC, USDC.decimals);
      add_quote = increaseLiquidityQuoteByInputTokenWithParams({
        // Pass the pool definition and state
        tokenMintA: WSOL.mint,
        tokenMintB: USDC.mint,
        sqrtPrice: main_whirlpool_data.sqrtPrice,
        tickCurrentIndex: main_whirlpool_data.tickCurrentIndex,
        // Price range
        tickLowerIndex: lower_tick_index,
        tickUpperIndex: higher_tick_index,
        // Input token and amount
        inputTokenMint: inputTokenMint,
        inputTokenAmount: inputTokenAmount,
        // Acceptable slippage
        slippageTolerance: slippage,
        // Get token info for TokenExtensions
        tokenExtensionCtx: mainTokenExtensionCtx,
      });
    }

    console.log(`WSOL in: ${DecimalUtil.fromBN(add_quote.tokenEstA, WSOL.decimals)}`);
    console.log(`USDC in: ${DecimalUtil.fromBN(add_quote.tokenEstB, USDC.decimals)}`);

    const add_liquidity_tx = await next_position.increaseLiquidity(add_quote);
    const addLiquidityInstruction = add_liquidity_tx.compressIx(true);

    if (input_SOL_amount.lt(add_quote.tokenEstA)) { // when SOL balance is insufficient
      console.log("Sol balance is insufficient");
      const swapQuote = await swapQuoteByOutputToken(
        swap_whirlpool,
        // Input token and amount
        WSOL.mint,
        add_quote.tokenEstA.sub(input_SOL_amount),
        slippage,
        ctx.program.programId,
        ctx.fetcher,
        IGNORE_CACHE,
      );

      console.log(`USDC in: ${DecimalUtil.fromBN(swapQuote.estimatedAmountIn, USDC.decimals)}`);
      console.log(`WSOL out: ${DecimalUtil.fromBN(swapQuote.estimatedAmountOut, WSOL.decimals)}`);

      const swapTx = await swap_whirlpool.swap(swapQuote);
      const swapInstruction = swapTx.compressIx(true);
      decrease_liquidity_tx.addInstruction(swapInstruction);
    }
    else if (input_USDC_amount.lt(add_quote.tokenEstB)) { // when USDC balance is insufficient
      console.log("USDC balance is insufficient");
      const swapQuote = await swapQuoteByOutputToken(
        swap_whirlpool,
        // Input token and amount
        USDC.mint,
        add_quote.tokenEstB.sub(input_USDC_amount),
        slippage,
        ctx.program.programId,
        ctx.fetcher,
        IGNORE_CACHE,
      );

      console.log(`WSOL in: ${DecimalUtil.fromBN(swapQuote.estimatedAmountIn, WSOL.decimals)}`);
      console.log(`USDC out: ${DecimalUtil.fromBN(swapQuote.estimatedAmountOut, USDC.decimals)}`);

      const swapTx = await swap_whirlpool.swap(swapQuote);
      console.log("here")
      const swapInstruction = swapTx.compressIx(true);
      decrease_liquidity_tx.addInstruction(swapInstruction);
    }


    decrease_liquidity_tx.addInstruction(addLiquidityInstruction);

    // Prepend CU instruction
    decrease_liquidity_tx.prependInstruction({
      instructions: [
        ComputeBudgetProgram.setComputeUnitLimit({
          units: 160000,
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
    const built = await decrease_liquidity_tx.build({
      maxSupportedTransactionVersion: 0,
      lookupTableAccounts: [lookupTableAccount],
    });

    await manualSend(built);
  } catch (err) {
    console.log(`Moving Liquidity: ${err}`);
  }
}

move_liquidity_between_positions(
  new PublicKey("2dC5MvaeRyL7K882Q4W1TGFkCg4cf6F3wwrqRGYQjhMq"),
  new PublicKey("HooAnkC4woRpnnqtpxVmCg9QHKAafrYCJwcCAmMPSw4L"),
);