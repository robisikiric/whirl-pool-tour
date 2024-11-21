import {
  getAllPositionAccountsByOwner,
} from "@orca-so/whirlpools-sdk";
import {
  ctx,
} from "./config";

async function find_my_orca_pool() {
  // 01_find_my_orca_pools.ts
  // ver 1.03 from 08/11/2024

  try {
    // Get all positions accounts of whirlpools
    const positions = await getAllPositionAccountsByOwner({
      ctx: ctx,
      owner: ctx.wallet.publicKey
    });

    console.log(positions.positionsWithTokenExtensions)
  
    let poolIds = [];
    for (const pos of positions.positionsWithTokenExtensions.values()) {
      const pool_id = pos.whirlpool.toBase58();
      if (!poolIds.includes(pool_id))
      poolIds.push(pool_id);
    }
    console.log("poolIds", poolIds);
    return poolIds;
  } catch (err) {
    console.log(`Error: ${err}`);
  }
}

find_my_orca_pool();