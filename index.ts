import { get_my_positions_info } from "./src/get_my_positions_info";
import { move_liquidity_between_positions } from "./src/move_liquidity_between_positions";
import { collect_fee } from "./src/7_collect_fee";
import { sleep, tgBotSend } from "./src/utils";
import { SLEEPING_TIME } from "./src/config";

async function start() {
  const origLog = console.log;
  
  console.log   = function (obj, ...placeholders) {
    if (typeof obj === "string")
      placeholders.unshift("[" + new Date().toISOString() + "] " + obj);
    else {
      placeholders.unshift(obj);
      placeholders.unshift("[" + new Date().toISOString() + "] %j");
    }

    origLog.apply(this, placeholders);
  };

  while (true) {
    // get next position and current position id
    const { cur_pos, next_pos } = await get_my_positions_info();
  
    // move liquidity if there is a next position and current position is not the same
    if (next_pos && cur_pos && next_pos.toBase58() !== cur_pos.toBase58()) {
      tgBotSend(`<b>🟢🟢🟢Out of Range: ${cur_pos.toBase58()}</b>`);
      console.log(`Moving liquidity from ${cur_pos.toBase58()} to ${next_pos.toBase58()}`);
      // await move_liquidity_between_positions(cur_pos, next_pos);
    }

    // Collect Fee
    await collect_fee();

    // sleep until next check
    await sleep(SLEEPING_TIME);
  }
}

start();