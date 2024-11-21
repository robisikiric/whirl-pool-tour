import { ComputeBudgetProgram, PublicKey } from "@solana/web3.js";
import {
  PDAUtil,
  PoolUtil,
  WhirlpoolIx,
  decreaseLiquidityQuoteByLiquidityWithParams,
  TokenExtensionUtil,
  IGNORE_CACHE,
} from "@orca-so/whirlpools-sdk";
import {
  Instruction,
  EMPTY_INSTRUCTION,
  resolveOrCreateATA,
  TransactionBuilder,
  Percentage,
  DecimalUtil,
} from "@orca-so/common-sdk";
import { 
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  TOKEN_2022_PROGRAM_ID,
} from "@solana/spl-token";
import {
  ctx,
  client,
  CU_instruction,
  lookupTableAddress,
} from "./config";
import { manualSend } from "./utils";
import { BN } from "bn.js";

async function closePosition(position_id: PublicKey) {
  try {
    // Set acceptable slippage
    const slippage = Percentage.fromFraction(25, 1000); // 1%
  
    // Get the position and the pool to which the position belongs
    const position = await client.getPosition(position_id);
    const position_owner = ctx.wallet.publicKey;
    const position_token_account = getAssociatedTokenAddressSync(position.getData().positionMint, position_owner, true, TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID);
    const whirlpool_pubkey = position.getData().whirlpool;
    const whirlpool = await client.getPool(whirlpool_pubkey, IGNORE_CACHE);
    const whirlpool_data = whirlpool.getData();
  
    const token_a = whirlpool.getTokenAInfo();
    const token_b = whirlpool.getTokenBInfo();
  
    // Get TickArray and Tick
    const tick_spacing = whirlpool.getData().tickSpacing;
    const tick_array_lower_pubkey = PDAUtil.getTickArrayFromTickIndex(position.getData().tickLowerIndex, tick_spacing, whirlpool_pubkey, ctx.program.programId).publicKey;
    const tick_array_upper_pubkey = PDAUtil.getTickArrayFromTickIndex(position.getData().tickUpperIndex, tick_spacing, whirlpool_pubkey, ctx.program.programId).publicKey;
  
    // Create token accounts to receive fees and rewards
    // Collect mint addresses of tokens to receive
    const tokens_to_be_collected = new Set<string>();
    tokens_to_be_collected.add(token_a.mint.toBase58());
    tokens_to_be_collected.add(token_b.mint.toBase58());
    whirlpool.getData().rewardInfos.map((reward_info) => {
      if ( PoolUtil.isRewardInitialized(reward_info) ) {
        tokens_to_be_collected.add(reward_info.mint.toBase58());
      }
    });
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
  
    // Build the instruction to update fees and rewards
    let update_fee_and_rewards_ix = WhirlpoolIx.updateFeesAndRewardsIx(
      ctx.program,
      {
        whirlpool: position.getData().whirlpool,
        position: position_id,
        tickArrayLower: tick_array_lower_pubkey,
        tickArrayUpper: tick_array_upper_pubkey,
      }
    );
    
    // Build the instruction to collect fees
    let collect_fees_ix = WhirlpoolIx.collectFeesIx(
      ctx.program,
      {
        whirlpool: whirlpool_pubkey,
        position: position_id,
        positionAuthority: position_owner,
        positionTokenAccount: position_token_account,
        tokenOwnerAccountA: token_account_map.get(token_a.mint.toBase58()),
        tokenOwnerAccountB: token_account_map.get(token_b.mint.toBase58()),
        tokenVaultA: whirlpool.getData().tokenVaultA, 
        tokenVaultB: whirlpool.getData().tokenVaultB,
      }
    );
  
    // Build the instructions to collect rewards
    const collect_reward_ix = [EMPTY_INSTRUCTION, EMPTY_INSTRUCTION, EMPTY_INSTRUCTION];
    for (let i=0; i<whirlpool.getData().rewardInfos.length; i++) {
      const reward_info = whirlpool.getData().rewardInfos[i];
      if ( !PoolUtil.isRewardInitialized(reward_info) ) continue;
  
      collect_reward_ix[i] = WhirlpoolIx.collectRewardIx(
        ctx.program,
        {
          whirlpool: whirlpool_pubkey,
          position: position_id,
          positionAuthority: position_owner,
          positionTokenAccount: position_token_account,
          rewardIndex: i,
          rewardOwnerAccount: token_account_map.get(reward_info.mint.toBase58()),
          rewardVault: reward_info.vault,
        }
      );
    }
  
    // Create a transaction and add the instruction
    const tx_builder = new TransactionBuilder(ctx.connection, ctx.wallet);
    // Create token accounts
    required_ta_ix.map((ix) => tx_builder.addInstruction(ix));
    tx_builder
      // Update fees and rewards, collect fees, and collect rewards
      // .addInstruction(update_fee_and_rewards_ix)
      .addInstruction(collect_fees_ix)
      .addInstruction(collect_reward_ix[0])
      .addInstruction(collect_reward_ix[1])
      .addInstruction(collect_reward_ix[2]);

    if (position.getData().liquidity.gt(new BN(0))) {
      console.log("here")
      // Estimate the amount of tokens that can be withdrawn from the position
      const quote = decreaseLiquidityQuoteByLiquidityWithParams({
        // Pass the pool state as is
        sqrtPrice: whirlpool_data.sqrtPrice,
        tickCurrentIndex: whirlpool_data.tickCurrentIndex,
        // Pass the price range of the position as is
        tickLowerIndex: position.getData().tickLowerIndex,
        tickUpperIndex: position.getData().tickUpperIndex,
        // Liquidity to be withdrawn (All liquidity)
        liquidity: position.getData().liquidity,
        // Acceptable slippage
        slippageTolerance: slippage,
        // Get token info for TokenExtensions
        tokenExtensionCtx: await TokenExtensionUtil.buildTokenExtensionContext(ctx.fetcher, whirlpool_data),
      });
    
      // Output the estimation
      console.log("SOL min output:", DecimalUtil.fromBN(quote.tokenMinA, token_a.decimals).toFixed(token_a.decimals));
      console.log("USDC min output:", DecimalUtil.fromBN(quote.tokenMinB, token_b.decimals).toFixed(token_b.decimals));
      
      // Build the instruction to decrease liquidity
      const decrease_liquidity_ix = WhirlpoolIx.decreaseLiquidityIx(
        ctx.program,
        {
          ...quote,
          whirlpool: whirlpool_pubkey,
          position: position_id,
          positionAuthority: position_owner,
          positionTokenAccount: position_token_account,
          tokenOwnerAccountA: token_account_map.get(token_a.mint.toBase58()),
          tokenOwnerAccountB: token_account_map.get(token_b.mint.toBase58()),
          tokenVaultA: whirlpool.getData().tokenVaultA, 
          tokenVaultB: whirlpool.getData().tokenVaultB,
          tickArrayLower: tick_array_lower_pubkey,
          tickArrayUpper: tick_array_upper_pubkey,
        }
      );
  
      tx_builder.addInstruction(decrease_liquidity_ix);
    }
  
    // Build the instruction to close the position
    const close_position_ix = WhirlpoolIx.closePositionWithTokenExtensionsIx(
      ctx.program,
      {
        position: position_id,
        positionAuthority: position_owner,
        positionTokenAccount: position_token_account,
        positionMint: position.getData().positionMint,
        receiver: position_owner,
      }
    );
    tx_builder.addInstruction(close_position_ix);

    // Prepend CU instruction
    tx_builder.prependInstruction({
      instructions: [
        ComputeBudgetProgram.setComputeUnitLimit({
          units: 80000,
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
    const built = await tx_builder.build({
      maxSupportedTransactionVersion: 0,
      lookupTableAccounts: [lookupTableAccount],
    });

    manualSend(built);
  
    // // Send the transaction
    // const signature = await tx_builder.buildAndExecute();
    // console.log("signature:", signature);
  
    // // Wait for the transaction to complete
    // const latest_blockhash = await ctx.connection.getLatestBlockhash();
    // await ctx.connection.confirmTransaction({signature, ...latest_blockhash}, "confirmed");
  } catch (err) {
    console.log(`Closing position: ${err}`);
  }
}

closePosition(
  new PublicKey("8xvC86wySULNhBqd2pXeBGwdvEuwnu94F3boaEGNzWNM")
);
