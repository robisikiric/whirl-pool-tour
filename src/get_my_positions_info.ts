import { PublicKey } from "@solana/web3.js";
import { getAllPositionAccountsByOwner, PositionData, PriceMath } from "@orca-so/whirlpools-sdk"
import { BN } from "bn.js";
import { ctx, client, MAIN_POOL_ID, TICK_LIMIT, WSOL, USDC } from "./config"

interface ExtendedPositionData extends PositionData {
  address: PublicKey;
}

export const get_my_positions_info = async () => {
  try {
    // Get the pool to which the position belongs
    const whirlpool = await client.getPool(MAIN_POOL_ID);
    await whirlpool.refreshData();
    const whirlpool_data = whirlpool.getData();

    const positions = await getAllPositionAccountsByOwner({
      ctx: ctx,
      owner: ctx.wallet.publicKey,
      includesPositions: false,
      includesPositionsWithTokenExtensions: true,
      includesBundledPositions: false,
    });

    let position_list: ExtendedPositionData[] = [];
    for (const pos of positions.positionsWithTokenExtensions.entries()) {
      // Check position's pool_id
      if (pos[1].whirlpool.toBase58() === MAIN_POOL_ID.toBase58()) {
        position_list.push({
          ...pos[1],
          address: new PublicKey(pos[0])
        });
      }
    }

    // sort positions
    // position_list = position_list.sort((a, b) => a.tickLowerIndex - b.tickLowerIndex);

    // get current index of positions 
    let cur_pos: PublicKey = null, next_pos: PublicKey = null;
    for (const pos of position_list) {
      if ((pos.tickLowerIndex + TICK_LIMIT) < whirlpool_data.tickCurrentIndex && whirlpool_data.tickCurrentIndex < (pos.tickUpperIndex - TICK_LIMIT)) {
        next_pos = pos.address;
      }
      if (pos.liquidity.gt(new BN(1000)))
        cur_pos = pos.address;
    }
    console.log(' ');
    console.log(`Current Price: ${PriceMath.sqrtPriceX64ToPrice(whirlpool_data.sqrtPrice, WSOL.decimals, USDC.decimals)}`);

    console.log(`Current Position: ${cur_pos?.toBase58()}`);
    console.log(`Next position: ${next_pos?.toBase58()}`);

    return {
      next_pos,
      cur_pos,
    }
  } catch (err) {
    console.log(`Getting positions info: ${err}`)
  }
}

// get_my_positions_info();