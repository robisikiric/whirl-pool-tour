import { ASSOCIATED_TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync, TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import {
  collectFeesQuote,
  getAllPositionAccountsByOwner,
  PDAUtil,
  TickArrayUtil,
  TokenExtensionUtil,
  PriceMath,
  IGNORE_CACHE,
} from "@orca-so/whirlpools-sdk";
import {
  DecimalUtil,
} from "@orca-so/common-sdk";
import {
  ctx,
  client,
  MAIN_POOL_ID,
  WSOL,
  USDC,
} from "./config";
import { BN } from "bn.js";

async function check_fee() {
  try {
    const position_owner = ctx.wallet.publicKey;

    // Get the pool to which the position belongs
    const whirlpool = await client.getPool(MAIN_POOL_ID, IGNORE_CACHE);
    const whirlpool_data = whirlpool.getData();

    const sqrt_price_x64 = whirlpool_data.sqrtPrice;
    const price = PriceMath.sqrtPriceX64ToPrice(sqrt_price_x64, WSOL.decimals, USDC.decimals);
    console.log(`Current Price: ${price.toFixed(USDC.decimals)}`);

    // Get token extensionCtx
    const tokenExtensionCtx = await TokenExtensionUtil.buildTokenExtensionContext(ctx.fetcher, whirlpool_data);

    const positions = await getAllPositionAccountsByOwner({
      ctx: ctx,
      owner: position_owner,
      includesPositions: false,
      includesPositionsWithTokenExtensions: true,
      includesBundledPositions: false,
    });

    let amount_WSOL = new BN(0), amount_USDC = new BN(0);

    for (const pos of positions.positionsWithTokenExtensions.entries()) {
      // Check position's pool_id
      if (pos[1].whirlpool.toBase58() === MAIN_POOL_ID.toBase58()) {
        // Get TickArray and Tick
        const tick_spacing = whirlpool.getData().tickSpacing;
        const tick_array_lower_pubkey = PDAUtil.getTickArrayFromTickIndex(pos[1].tickLowerIndex, tick_spacing, MAIN_POOL_ID, ctx.program.programId).publicKey;
        const tick_array_upper_pubkey = PDAUtil.getTickArrayFromTickIndex(pos[1].tickUpperIndex, tick_spacing, MAIN_POOL_ID, ctx.program.programId).publicKey;
        const tick_array_lower = await ctx.fetcher.getTickArray(tick_array_lower_pubkey);
        const tick_array_upper = await ctx.fetcher.getTickArray(tick_array_upper_pubkey);
        const tick_lower = TickArrayUtil.getTickFromArray(tick_array_lower, pos[1].tickLowerIndex, tick_spacing);
        const tick_upper = TickArrayUtil.getTickFromArray(tick_array_upper, pos[1].tickUpperIndex, tick_spacing);

        const position_token_account = getAssociatedTokenAddressSync(pos[1].positionMint, position_owner, true, TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID);
        
        // Get trade fee
        const quote_fee = collectFeesQuote({
          whirlpool: whirlpool.getData(),
          position: pos[1],
          tickLower: tick_lower,
          tickUpper: tick_upper,
          tokenExtensionCtx,
        });

        amount_WSOL = amount_WSOL.add(quote_fee.feeOwedA);
        amount_USDC = amount_USDC.add(quote_fee.feeOwedB);
      }
    }

    const total_balance_in_USDC = price.mul(DecimalUtil.fromBN(amount_WSOL, WSOL.decimals)).add(DecimalUtil.fromBN(amount_USDC, USDC.decimals));
    console.log(`Total Fee: ${total_balance_in_USDC.toFixed(USDC.decimals)}`);
  } catch (err) {
    console.log(`Collecting fee: ${err}`);
  }
}

check_fee();