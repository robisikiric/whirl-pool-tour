// config.ts
// ver 1.04 from 11/11/2024

import { Connection, PublicKey, Keypair, ComputeBudgetProgram, SystemProgram } from "@solana/web3.js";
import { AnchorProvider, Wallet } from "@coral-xyz/anchor";
import {
  WhirlpoolContext,
  buildWhirlpoolClient,
  ORCA_WHIRLPOOL_PROGRAM_ID,
} from "@orca-so/whirlpools-sdk";
import { DecimalUtil, Instruction } from "@orca-so/common-sdk";
import { JitoJsonRpcClient } from "jito-js-rpc";
import Decimal from "decimal.js";
import TelegramBot from "node-telegram-bot-api"
import secret from "./main.json";

const connection = new Connection("https://cold-still-dream.solana-mainnet.quiknode.pro/2f21b7399400acca9fd38beaa76fd7bf1417c3b8", "confirmed");  // quicknode
export const feePayer = Keypair.fromSecretKey(new Uint8Array(secret));
const wallet = new Wallet(feePayer);

export const provider = new AnchorProvider(connection, wallet, {commitment: "confirmed"});
export const ctx = WhirlpoolContext.withProvider(provider, ORCA_WHIRLPOOL_PROGRAM_ID);
export const client = buildWhirlpoolClient(ctx);

// jito
export const jitoClient = new JitoJsonRpcClient('https://amsterdam.mainnet.block-engine.jito.wtf/api/v1', "");

// Token definition
export const WSOL = {mint: new PublicKey("So11111111111111111111111111111111111111112"), decimals: 9}; // WSOL
export const USDC = {mint: new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"), decimals: 6}; // USDC
// export const USDC = {mint: new PublicKey("9TY6DUg1VSssYH5tFE95qoq5hnAGFak4w3cn72sJNCoV"), decimals: 9}; // DOGE

// WhirlpoolsConfig account
// devToken ecosystem / Orca Whirlpools
// export const WHIRLPOOLS_CONFIG = new PublicKey("FcrweFY1G9HJAHG5inkGB6pKg1HZ6x9UC2WioAfWrGkR");
export const WHIRLPOOLS_CONFIG = new PublicKey("2LecshUwdy9xi7meFgHtFJQNSKk4KdTrcpvaB56dP2NQ");

// Address Lookup Table
// export const lookupTableAddress  = new PublicKey("MYEhXvTHbMeKGTQ9njWFSwDkCHGSJhNj2dTqtKnxKDd");
export const lookupTableAddress  = new PublicKey("ExnxS1798eAMsx8kQEFjo1WpkYnas5yFKahTgDuXKu25");

export const minPriorityFeeLamports = 1000;
export const maxPriorityFeeLamports = 100000;
export const jitoTipLamports = 30000;
// export const computeLimitMargin = 200000;
export const computeLimitMargin = 230000;
const jitoTipAccount = new PublicKey("96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5");
const jitoTipAmount = 40000; // lamports

export const CU_instruction: Instruction = {
  instructions: [
    ComputeBudgetProgram.setComputeUnitLimit({
      units: computeLimitMargin,
    }),
    ComputeBudgetProgram.setComputeUnitPrice({
      microLamports: 200000,
    }),
  ],
  signers: [],
  cleanupInstructions: [],
};

export const JITO_ix: Instruction = {
  instructions: [
    SystemProgram.transfer({
      fromPubkey: feePayer.publicKey,
      toPubkey: jitoTipAccount,
      lamports: jitoTipAmount,
    })
  ],
  signers: [],
  cleanupInstructions: [],
}

export const MIN_BALANCE_SOL = DecimalUtil.toBN(new Decimal("0.1" /* WSOL */), WSOL.decimals);
export const MIN_BALANCE_USDC = DecimalUtil.toBN(new Decimal("0" /* USDC */), USDC.decimals);

export const MAIN_POOL_ID = new PublicKey("Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE");
export const SWAP_POOL_ID = new PublicKey("83v8iPyZihDEjDdY8RdZddyZNyUtXngz69Lgo9Kt5d6d");

export const TICK_LIMIT = 15;
export const SLEEPING_TIME = 3 * 60 * 1000;
export const COLLECT_FEE_LIMIT = new Decimal("5" /* USDC */);

const TG_BOT_TOKEN = "8060833983:AAHWkvRk6aWQ6Q1Vh6mF-vIEIUdh30kk1ZE";
export const tgBot = new TelegramBot(TG_BOT_TOKEN);
export const TG_CHAT_ID="-4584727775";