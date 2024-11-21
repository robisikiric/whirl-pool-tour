import {
  get_USDC_balance,
} from "./utils";
import {
  client,
  ctx,
  MAIN_POOL_ID,
  USDC,
  WSOL,
} from "./config";
import { PublicKey } from "@solana/web3.js";
import { DecimalUtil } from "@orca-so/common-sdk";
import { getAllPositionAccountsByOwner, PoolUtil, PriceMath } from "@orca-so/whirlpools-sdk";
import { BN } from "bn.js";

async function get_pool_balance() {
  const whirlpool = await client.getPool(MAIN_POOL_ID);
  const whirlpool_data = whirlpool.getData();

  // Get the current price of the pool
  const sqrt_price_x64 = whirlpool_data.sqrtPrice;
  const price = PriceMath.sqrtPriceX64ToPrice(sqrt_price_x64, WSOL.decimals, USDC.decimals);

  // Get all positions accounts of whirlpools
  const positions = await getAllPositionAccountsByOwner({
    ctx: ctx,
    owner: ctx.wallet.publicKey
  });

  let amount_WSOL = new BN(0), amount_USDC = new BN(0);
  for (const pos of positions.positionsWithTokenExtensions.values()) {
    // Check position's pool_id
    if (pos.whirlpool.toBase58() === MAIN_POOL_ID.toBase58()) {
      // Check position's price_range
      const amount = PoolUtil.getTokenAmountsFromLiquidity(
        pos.liquidity,
        whirlpool.getData().sqrtPrice,
        PriceMath.tickIndexToSqrtPriceX64(pos.tickLowerIndex),
        PriceMath.tickIndexToSqrtPriceX64(pos.tickUpperIndex),
        true
      );
      // Add the SOL amount to the total SOL_amount
      amount_WSOL = amount_WSOL.add(amount.tokenA);
      amount_USDC = amount_USDC.add(amount.tokenB);
    }
  }

  console.log("SOL: ", DecimalUtil.fromBN(amount_WSOL, WSOL.decimals));
  console.log("USDC: ", DecimalUtil.fromBN(amount_USDC, USDC.decimals));
  const total_balance_in_USDC = price.mul(DecimalUtil.fromBN(amount_WSOL, WSOL.decimals)).add(DecimalUtil.fromBN(amount_USDC, USDC.decimals));
  console.log("Total: ", total_balance_in_USDC.toFixed(USDC.decimals));
}

get_pool_balance();