import { ComputeBudgetProgram, PublicKey } from "@solana/web3.js";
import { ASSOCIATED_TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync, TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import {
  collectFeesQuote,
  getAllPositionAccountsByOwner,
  IGNORE_CACHE,
  increaseLiquidityQuoteByInputTokenWithParams,
  PDAUtil,
  PriceMath,
  swapQuoteByOutputToken,
  TickArrayUtil,
  TokenExtensionUtil,
  WhirlpoolIx,
} from "@orca-so/whirlpools-sdk";
import {
  TransactionBuilder,
  resolveOrCreateATA,
  Instruction,
  Percentage,
  DecimalUtil,
} from "@orca-so/common-sdk";
import {
  ctx,
  client,
  MAIN_POOL_ID,
  WSOL,
  USDC,
  CU_instruction,
  lookupTableAddress,
  MIN_BALANCE_SOL,
  SWAP_POOL_ID,
  COLLECT_FEE_LIMIT,
} from "./config";
import { BN } from "bn.js";
import { get_SOL_balance, get_USDC_balance, manualSend } from "./utils";
import Decimal from "decimal.js";

export async function collect_fee() {
  try {
    const position_owner = ctx.wallet.publicKey;

    // Get the pool to which the position belongs
    const whirlpool = await client.getPool(MAIN_POOL_ID, IGNORE_CACHE);
    const whirlpool_data = whirlpool.getData();
    const swap_whirlpool = await client.getPool(SWAP_POOL_ID, IGNORE_CACHE);

    // Set slippage
    const slippage = Percentage.fromFraction(100, 1000); // 2.5%

    // Get the current price of the pool
    const sqrt_price_x64 = whirlpool_data.sqrtPrice;
    const price = PriceMath.sqrtPriceX64ToPrice(sqrt_price_x64, WSOL.decimals, USDC.decimals);

    const positions = await getAllPositionAccountsByOwner({
      ctx: ctx,
      owner: position_owner,
      includesPositions: false,
      includesPositionsWithTokenExtensions: true,
      includesBundledPositions: false,
    });

    // Get token info for TokenExtensions
    const tokenExtensionCtx = await TokenExtensionUtil.buildTokenExtensionContext(ctx.fetcher, whirlpool.getData());

    const tokens_to_be_collected = new Set<string>();
    tokens_to_be_collected.add(WSOL.mint.toBase58());
    tokens_to_be_collected.add(USDC.mint.toBase58());

    // Get addresses of token accounts and get instructions to create if it does not exist
    const required_ta_ix: Instruction[] = [];
    const token_account_map = new Map<string, PublicKey>();
    for ( let mint_b58 of tokens_to_be_collected ) {
      const mint = new PublicKey(mint_b58);
      // If present, ix is EMPTY_INSTRUCTION
      const {address, ...ix} = await resolveOrCreateATA(
        ctx.connection,
        position_owner,
        mint,
        () => ctx.fetcher.getAccountRentExempt()
      );
      required_ta_ix.push(ix);
      token_account_map.set(mint_b58, address);
    }

    let amount_WSOL = new BN(0), amount_USDC = new BN(0);

    // Create a transaction and add the instruction
    const tx_builder = new TransactionBuilder(ctx.connection, ctx.wallet);

    // Create token accounts
    required_ta_ix.map((ix) => tx_builder.addInstruction(ix));

    let other_position: PublicKey;
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

        if (pos[1].liquidity.gt(new BN(0)) && (pos[1].tickLowerIndex > whirlpool_data.tickCurrentIndex || whirlpool_data.tickCurrentIndex < pos[1].tickUpperIndex)) {
          other_position = new PublicKey(pos[0]);
        }

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

        // Check if position has fee to collect
        if (quote_fee.feeOwedA.gt(new BN(0)) && quote_fee.feeOwedB.gt(new BN(0))) {
          // Check if position has liquidity
          if (pos[1].liquidity.gt(new BN(0))) {
            // Build the instruction to update fees and rewards
            const update_fee_and_rewards_ix = WhirlpoolIx.updateFeesAndRewardsIx(
              ctx.program,
              {
                whirlpool: pos[1].whirlpool,
                position: new PublicKey(pos[0]),
                tickArrayLower: tick_array_lower_pubkey,
                tickArrayUpper: tick_array_upper_pubkey,
              }
            );
  
            tx_builder.addInstruction(update_fee_and_rewards_ix);
          }
  
          // Build the instruction to collect fees
          const collect_fees_ix = WhirlpoolIx.collectFeesIx(
            ctx.program,
            {
              whirlpool: pos[1].whirlpool,
              position: new PublicKey(pos[0]),
              positionAuthority: position_owner,
              positionTokenAccount: position_token_account,
              tokenOwnerAccountA: token_account_map.get(WSOL.mint.toBase58()),
              tokenOwnerAccountB: token_account_map.get(USDC.mint.toBase58()),
              tokenVaultA: whirlpool_data.tokenVaultA, 
              tokenVaultB: whirlpool_data.tokenVaultB,
            }
          );

          tx_builder.addInstruction(collect_fees_ix);
        }
      }
    }

    // const total_balance_in_USDC = price.mul(DecimalUtil.fromBN(amount_WSOL, WSOL.decimals)).add(DecimalUtil.fromBN(amount_USDC, USDC.decimals));
    // if (total_balance_in_USDC.lt(COLLECT_FEE_LIMIT)) {
    //   console.log(`Not enough funds to withdraw: ${total_balance_in_USDC.toFixed(USDC.decimals)}`);
    //   return;
    // }

    // if (!other_position) {
    //   console.log(`No position is opened for current price: ${price.toFixed(USDC.decimals)}`);
    //   return;
    // }

    // // Get current sol and usdc balance of wallet
    // const current_SOL_balance = await get_SOL_balance(ctx.wallet.publicKey);
    // const current_USDC_balance = await get_USDC_balance(ctx.wallet.publicKey);

    // const input_SOL_amount = current_SOL_balance.sub(MIN_BALANCE_SOL).add(amount_WSOL);
    // const input_USDC_amount = current_USDC_balance.add(amount_USDC);

    // const position = await client.getPosition(other_position);
    // const positionData = position.getData();

    // // Calculate tick index for the low and high price
    // const lower_tick_index = positionData.tickLowerIndex;
    // const higher_tick_index = positionData.tickUpperIndex;

    // const deposit_amount_USDC = total_balance_in_USDC.mul(whirlpool_data.tickCurrentIndex - lower_tick_index).div(higher_tick_index - lower_tick_index);

    // const increase_quote = increaseLiquidityQuoteByInputTokenWithParams({
    //   // Pass the pool definition and state
    //   tokenMintA: WSOL.mint,
    //   tokenMintB: USDC.mint,
    //   sqrtPrice: whirlpool_data.sqrtPrice,
    //   tickCurrentIndex: whirlpool_data.tickCurrentIndex,
    //   // Price range
    //   tickLowerIndex: positionData.tickLowerIndex,
    //   tickUpperIndex: positionData.tickUpperIndex,
    //   // Input token and amount
    //   inputTokenMint: USDC.mint,
    //   inputTokenAmount: DecimalUtil.toBN(deposit_amount_USDC, USDC.decimals),
    //   // Acceptable slippage
    //   slippageTolerance: slippage,
    //   // Get token info for TokenExtensions
    //   tokenExtensionCtx: tokenExtensionCtx,
    // });
    // const increase_tx = await position.increaseLiquidity(increase_quote);
    // const increase_ix = increase_tx.compressIx(true);
    
    // console.log(other_position.toBase58());

    // // Check if SOL or USDC balance is sufficient for the transaction
    // if (input_SOL_amount.lt(increase_quote.tokenMaxA)) { // when SOL balance is insufficient
    //   const swapQuote = await swapQuoteByOutputToken(
    //     swap_whirlpool,
    //     // Input token and amount
    //     WSOL.mint,
    //     increase_quote.tokenEstA.sub(input_SOL_amount),
    //     slippage,
    //     ctx.program.programId,
    //     ctx.fetcher,
    //     IGNORE_CACHE,
    //   );

    //   const swapTx = await swap_whirlpool.swap(swapQuote);
    //   const swapInstruction = swapTx.compressIx(true);
    //   tx_builder.addInstruction(swapInstruction);
    // }
    // else if (input_USDC_amount.lt(increase_quote.tokenMaxB)) { // when USDC balance is insufficient
    //   const swapQuote = await swapQuoteByOutputToken(
    //     swap_whirlpool,
    //     // Input token and amount
    //     USDC.mint,
    //     increase_quote.tokenEstB.sub(input_USDC_amount),
    //     slippage,
    //     ctx.program.programId,
    //     ctx.fetcher,
    //     IGNORE_CACHE,
    //   );

    //   // Output the estimation
    //   console.log("estimatedAmountIn:", DecimalUtil.fromBN(swapQuote.estimatedAmountIn, WSOL.decimals).toString(), "WSOL");
    //   console.log("estimatedAmountOut:", DecimalUtil.fromBN(swapQuote.estimatedAmountOut, USDC.decimals).toString(), "USDC");

    //   const swapTx = await swap_whirlpool.swap(swapQuote);
    //   const swapInstruction = swapTx.compressIx(true);
    //   tx_builder.addInstruction(swapInstruction);
    // }

    // tx_builder.addInstruction(increase_ix);

    // Prepend CU instruction
    tx_builder.prependInstruction({
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

    // console.log(`Size of Tx: ${tx_builder.txnSize()}`);
    // return;

    // get the table from the cluster
    const lookupTableAccount = (await ctx.connection.getAddressLookupTable(lookupTableAddress)).value;
    // const latest_blockhash = await ctx.connection.getLatestBlockhash();

    // manual build
    const built = await tx_builder.build({
      maxSupportedTransactionVersion: 0,
      lookupTableAccounts: [lookupTableAccount],
    });

    manualSend(built);
  } catch (err) {
    console.log(`Collecting fee: ${err}`);
  }
}

// collect_fee();