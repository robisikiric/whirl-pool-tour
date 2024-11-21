import {
  PublicKey,
  VersionedTransaction,
} from "@solana/web3.js";
import {
  getAssociatedTokenAddress,
} from "@solana/spl-token";
import {
  ctx,
  client,
  USDC,
  WSOL,
  tgBot,
  TG_CHAT_ID,
  jitoClient,
} from "./config";
import { BN } from "bn.js";
import { DecimalUtil, TransactionPayload } from "@orca-so/common-sdk";
import { PriceMath } from "@orca-so/whirlpools-sdk";
import base58 from "bs58";

export async function checkBalance(signature: string) {
  // get transaction detail
  const tx = await ctx.connection.getParsedTransaction(signature, {
    maxSupportedTransactionVersion: 0,
    commitment: 'confirmed'
  });
  const { preTokenBalances, postTokenBalances, preBalances, postBalances } = tx.meta;

  // get balances of WSOL and USDC before transaction
  const prev_WSOL = preBalances[0];
  const prev_USDC = preTokenBalances.find(ATA => ATA.mint === USDC.mint.toBase58() && ATA.owner === ctx.wallet.publicKey.toBase58());

  // get balances of WSOL and USDC after transaction
  const after_WSOL = postBalances[0];
  const after_USDC = postTokenBalances.find(ATA => ATA.mint === USDC.mint.toBase58() && ATA.owner === ctx.wallet.publicKey.toBase58());

  // get balance difference
  const diff_WSOL = after_WSOL - prev_WSOL;
  const diff_USDC = after_USDC.uiTokenAmount.uiAmount - prev_USDC.uiTokenAmount.uiAmount;

  console.log(`SOL ${diff_WSOL >= 0 ? 'in' : 'out'}: ${DecimalUtil.fromNumber(Math.abs(diff_WSOL), WSOL.decimals)}`);
  console.log(`USDC ${diff_USDC >= 0 ? 'in' : 'out'}: ${Math.abs(diff_USDC).toFixed(USDC.decimals)}`);
}

export async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function get_SOL_balance(wallet_address: PublicKey) {
  const balance = await ctx.connection.getBalance(wallet_address);
  
  return new BN(balance);
}

export async function get_USDC_balance(wallet_address: PublicKey) {
  // Get associated token address
  const ATA = await getAssociatedTokenAddress(USDC.mint, wallet_address);

  // Get balance of the token
  const balance = await ctx.connection.getTokenAccountBalance(ATA);
  
  return new BN(balance.value.amount);
}

export async function getPositionInfo(position_id: PublicKey, next_price: boolean) {
  const position = await client.getPosition(position_id);
  const lower_index = position.getData().tickLowerIndex;
  const upper_index = position.getData().tickUpperIndex;
  const lowerPrice = PriceMath.tickIndexToPrice(lower_index, WSOL.decimals, USDC.decimals)
  const upperPrice = PriceMath.tickIndexToPrice(upper_index, WSOL.decimals, USDC.decimals)
  console.log(lower_index, upper_index);
  if (next_price) {
    const nextPrice = PriceMath.tickIndexToPrice(upper_index + upper_index - lower_index, WSOL.decimals, USDC.decimals);
    console.log(`next_price1: ${PriceMath.invertPrice(upperPrice, WSOL.decimals, USDC.decimals)}`);
    console.log(`next_price2: ${PriceMath.invertPrice(nextPrice, WSOL.decimals, USDC.decimals)}`);
  }
  else {
    const prevPrice = PriceMath.tickIndexToPrice(lower_index - upper_index + lower_index, WSOL.decimals, USDC.decimals);
    console.log(`prev_price1: ${PriceMath.invertPrice(prevPrice, WSOL.decimals, USDC.decimals)}`);
    console.log(`prev_price2: ${PriceMath.invertPrice(lowerPrice, WSOL.decimals, USDC.decimals)}`);
  }
}

export const tgBotSend = (text: string) => {
  tgBot.sendMessage(TG_CHAT_ID, text, { parse_mode: 'HTML', disable_web_page_preview: false })
}

export const manualSend = async (built: TransactionPayload) => {
  const blockhash = await ctx.connection.getLatestBlockhashAndContext("confirmed");
  const blockHeight = await ctx.connection.getBlockHeight({commitment: "confirmed", minContextSlot: blockhash.context.slot});

  const transactionTTL = blockHeight + 151;

  const notSigned = built.transaction as VersionedTransaction;
  notSigned.message.recentBlockhash = blockhash.value.blockhash;

  if (built.signers.length > 0) notSigned.sign(built.signers);
  const signed = await ctx.wallet.signTransaction(notSigned);
  const signature = base58.encode(signed.signatures[0]);

  // manual send and confirm
  const waitToConfirm = () => new Promise((resolve) => setTimeout(resolve, 5000));
  const waitToRetry = () => new Promise((resolve) => setTimeout(resolve, 2000));

  const numTry = 10;
  let landed = false;
  for (let i = 0; i < numTry; i++) {
      // check transaction TTL
      const blockHeight = await ctx.connection.getBlockHeight("confirmed");
      if (blockHeight >= transactionTTL)  {
          console.log("transaction have been expired");
          break;
      }
      console.log("transaction is still valid,", transactionTTL - blockHeight, "blocks left (at most)");

      // send without retry on RPC server
      await ctx.connection.sendRawTransaction(signed.serialize(), {skipPreflight: false, maxRetries: 0});
      console.log("sent, signature", signature);

      await waitToConfirm();

      // check signature status
      const sigStatus = await ctx.connection.getSignatureStatus(signature);
      console.log("sigStatus", sigStatus.value?.confirmationStatus, sigStatus.context.slot);
      if (sigStatus.value?.confirmationStatus === "confirmed") {
          console.log("landed");
          landed = true;
          break;
      }

      // todo: need to increase wait time, but TTL is not long...
      await waitToRetry();
  }
  console.log("landed?", landed);
}

export async function confirmTransaction(signature: string, timeoutMs = 60000) {
  const start = Date.now();
  let status = await ctx.connection.getSignatureStatus(signature);
  
  while (Date.now() - start < timeoutMs) {
    status = await ctx.connection.getSignatureStatus(signature);
    if (status.value && status.value.confirmationStatus === 'finalized') {
      return status;
    }
    // Wait for a short time before checking again
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  
  throw new Error(`Transaction ${signature} failed to confirm within ${timeoutMs}ms`);
}

export const jitoSend = async (built: TransactionPayload) => {
  const blockhash = await ctx.connection.getLatestBlockhashAndContext("confirmed");

  const notSigned = built.transaction as VersionedTransaction;
  notSigned.message.recentBlockhash = blockhash.value.blockhash;

  if (built.signers.length > 0) notSigned.sign(built.signers);
  const signed = await ctx.wallet.signTransaction(notSigned);

  // Serialize and base58 encode the signed transaction
  const serializedTransaction = signed.serialize();
  const base58Transaction = base58.encode(serializedTransaction);

  try {
    // Send the transaction using sendTxn method
    const result = await jitoClient.sendTxn([base58Transaction], true);
    console.log('Transaction send result:', result);

    const signature = result.result;
    console.log('Transaction signature:', signature);

    // Wait for confirmation with a longer timeout
    const confirmation = await confirmTransaction(signature, 30000); // 120 seconds timeout
    console.log('Transaction confirmation:', confirmation);

    // If the above doesn't confirm, you can manually check the status
    const status = await ctx.connection.getSignatureStatus(signature);
    console.log('Transaction status:', status);

    if (confirmation.value.confirmationStatus && status.value.confirmationStatus === 'finalized') {
      const solscanUrl = `https://solscan.io/tx/${signature}`;
      console.log(`Transaction finalized. View details on Solscan: ${solscanUrl}`);
    } else {
      console.log('Transaction was not finalized within the expected time.');
    }

  } catch (error) {
    console.error('Error sending or confirming transaction:', error);
    if (error.response && error.response.data) {
      console.error('Server response:', error.response.data);
    }
  }
}

export const jitoBundleSend = async (builts: TransactionPayload[]) => {
  const blockhash = await ctx.connection.getLatestBlockhashAndContext("confirmed");

  let txList: string[] = [];
  for (const built of builts) {
    const notSigned = built.transaction as VersionedTransaction;
    notSigned.message.recentBlockhash = blockhash.value.blockhash;

    if (built.signers.length > 0) notSigned.sign(built.signers);
    const signed = await ctx.wallet.signTransaction(notSigned);

    // Serialize and base58 encode the signed transaction
    const serializedTransaction = signed.serialize();
    const base58Transaction = base58.encode(serializedTransaction);
    txList.push(base58Transaction);
  }

  try {
    // Send the bundle using sendBundle method
    const result = await jitoClient.sendBundle([txList]);
    console.log('Bundle send result:', result);

    const bundleId = result.result;
    console.log('Bundle ID:', bundleId);

    // Wait for confirmation with a longer timeout
    const inflightStatus = await jitoClient.confirmInflightBundle(bundleId, 120000); // 120 seconds timeout
    console.log('Inflight bundle status:', JSON.stringify(inflightStatus, null, 2));

    if (inflightStatus.confirmation_status === "confirmed") {
      console.log(`Bundle successfully confirmed on-chain at slot ${inflightStatus.slot}`);

      // Additional check for bundle finalization
      try {
        console.log('Attempting to get bundle status...');
        const finalStatus = await jitoClient.getBundleStatuses([[bundleId]]); // Note the double array
        console.log('Final bundle status response:', JSON.stringify(finalStatus, null, 2));

        if (finalStatus.result && finalStatus.result.value && finalStatus.result.value.length > 0) {
          const status = finalStatus.result.value[0];
          console.log('Confirmation status:', status.confirmation_status);

          const explorerUrl = `https://explorer.jito.wtf/bundle/${bundleId}`;
          console.log('Bundle Explorer URL:', explorerUrl);

          console.log('Final bundle details:', status);

          // Updated section to handle and display multiple transactions
          if (status.transactions && status.transactions.length > 0) {
            console.log(`Transaction URLs (${status.transactions.length} transaction${status.transactions.length > 1 ? 's' : ''} in this bundle):`);
            status.transactions.forEach((txId, index) => {
              const txUrl = `https://solscan.io/tx/${txId}`;
              console.log(`Transaction ${index + 1}: ${txUrl}`);
            });
            if (status.transactions.length === 5) {
              console.log('Note: This bundle has reached the maximum of 5 transactions.');
            }
          } else {
            console.log('No transactions found in the bundle status.');
          }
        } else {
          console.log('Unexpected final bundle status response structure');
        }
      } catch (statusError) {
        console.error('Error fetching final bundle status:', statusError.message);
        if (statusError.response && statusError.response.data) {
          console.error('Server response:', statusError.response.data);
        }
      }
    } else if (inflightStatus.err) {
      console.log('Bundle processing failed:', inflightStatus.err);
    } else {
      console.log('Unexpected inflight bundle status:', inflightStatus);
    }

  } catch (error) {
    console.error('Error sending or confirming bundle:', error);
    if (error.response && error.response.data) {
      console.error('Server response:', error.response.data);
    }
  }
}