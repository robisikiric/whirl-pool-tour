import {
  get_SOL_balance,
  get_USDC_balance,
} from "./utils";
import {
  client,
  ctx,
  MAIN_POOL_ID,
  USDC,
  WSOL,
} from "./config";
import { DecimalUtil } from "@orca-so/common-sdk";
import { IGNORE_CACHE, PriceMath } from "@orca-so/whirlpools-sdk";

async function get_wallet_balance() {
  // Get the pool to which the position belongs
  const whirlpool = await client.getPool(MAIN_POOL_ID, IGNORE_CACHE);
  const whirlpool_data = whirlpool.getData();

  // Get the current price of the pool
  const sqrt_price_x64 = whirlpool_data.sqrtPrice;
  const price = PriceMath.sqrtPriceX64ToPrice(sqrt_price_x64, WSOL.decimals, USDC.decimals);

  const amount_WSOL = await get_SOL_balance(ctx.wallet.publicKey);
  console.log("SOL: ", DecimalUtil.fromBN(amount_WSOL, WSOL.decimals));
  const amount_USDC = await get_USDC_balance(ctx.wallet.publicKey);
  console.log("USDC: ", DecimalUtil.fromBN(amount_USDC, USDC.decimals));
  const total_balance_in_USDC = price.mul(DecimalUtil.fromBN(amount_WSOL, WSOL.decimals)).add(DecimalUtil.fromBN(amount_USDC, USDC.decimals));
  console.log("Total: ", total_balance_in_USDC.toFixed(USDC.decimals));
}

get_wallet_balance();