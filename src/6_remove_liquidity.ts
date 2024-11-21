import { ComputeBudgetProgram, PublicKey } from "@solana/web3.js";
import {
  Percentage,
} from "@orca-so/common-sdk";
import {
  decreaseLiquidityQuoteByLiquidityWithParams,
  TokenExtensionUtil,
} from "@orca-so/whirlpools-sdk";
import {
  ctx,
  client,
  MAIN_POOL_ID,
  lookupTableAddress,
} from "./config";
import {
  manualSend,
} from "./utils";

export const remove_liquidity_between_positions = async (cur_pos: PublicKey) => {
  try {
    const main_whirlpool = await client.getPool(MAIN_POOL_ID);
    await main_whirlpool.refreshData();
    const cur_position = await client.getPosition(cur_pos);

    // Set slippage as 2.5%
    const slippage = Percentage.fromFraction(25, 1000);

    const main_whirlpool_data = main_whirlpool.getData();
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
      slippageTolerance: slippage,
      // Get token info for TokenExtensions
      tokenExtensionCtx: mainTokenExtensionCtx,
    });

    // Create a transaction
    const decrease_liquidity_tx = await cur_position.decreaseLiquidity(remove_quote);
    // Prepend CU instruction
    decrease_liquidity_tx.prependInstruction({
      instructions: [
        ComputeBudgetProgram.setComputeUnitLimit({
          units: 50000,
        }),
        ComputeBudgetProgram.setComputeUnitPrice({
          microLamports: 200000,
        }),
      ],
      signers: [],
      cleanupInstructions: [],
    });
    // decrease_liquidity_tx.addInstruction(JITO_ix);

    // get the table from the cluster
    const lookupTableAccount = (await ctx.connection.getAddressLookupTable(lookupTableAddress)).value;
    const latest_blockhash = await ctx.connection.getLatestBlockhash();

    // manual build
    const built = await decrease_liquidity_tx.build({
      maxSupportedTransactionVersion: 0,
      lookupTableAccounts: [lookupTableAccount],
    });

    await manualSend(built);
    // await jitoSend(built);
  } catch (err) {
    console.log(`Moving Liquidity: ${err}`);
  }
}

// remove_liquidity_between_positions(
//   new PublicKey("HooAnkC4woRpnnqtpxVmCg9QHKAafrYCJwcCAmMPSw4L")
// );