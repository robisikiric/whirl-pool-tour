// create_ALT.ts
// ver 1.04 from 11/11/2024

import {
  PublicKey,
  Keypair,
  AddressLookupTableProgram,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  ctx,
  lookupTableAddress,
  feePayer,
} from "./config";
import secret from "./main.json";

async function createALT(addresses: PublicKey[]) {
  try {
    const slot = await ctx.connection.getSlot();
  
    const [lookupTableInst, lookupTableAddress] = AddressLookupTableProgram.createLookupTable({
      authority: feePayer.publicKey,
      payer: feePayer.publicKey,
      recentSlot: slot
    });
  
    console.log("lookup table address: ", lookupTableAddress.toBase58());
    const extendInst = AddressLookupTableProgram.extendLookupTable({
      payer: feePayer.publicKey,
      authority: feePayer.publicKey,
      lookupTable: lookupTableAddress,
      addresses: [
        feePayer.publicKey,
        ...addresses
      ]
    });
  
    const tx = new Transaction().add(lookupTableInst, extendInst);
    const signature = await sendAndConfirmTransaction(ctx.connection, tx, [feePayer]);
    console.log("Signature: ", signature);
  } catch (err) {
    console.log(`Error: ${err}`);
  }
}

async function extendALT(addresses: PublicKey[]) {
  // Read in the private key from wallet.json (The public and private key pair will be managed using the Keypair class)
  const payer = Keypair.fromSecretKey(new Uint8Array(secret));

  const extendInst = AddressLookupTableProgram.extendLookupTable({
    payer: payer.publicKey,
    authority: payer.publicKey,
    lookupTable: lookupTableAddress,
    addresses: [
      ...addresses
    ]
  });

  const tx = new Transaction().add(extendInst);
  const signature = await sendAndConfirmTransaction(ctx.connection, tx, [payer]);
  console.log("Signature: ", signature);
}

// createALT(
//   [
//     new PublicKey("11111111111111111111111111111111"), // System Program
//     new PublicKey("SysvarRent111111111111111111111111111111111"), // Rent Program
//     new PublicKey("ComputeBudget111111111111111111111111111111"), // Computer Budget Program
//     new PublicKey("whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc"), // Orca Program
//     new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"), // Token Program
//     new PublicKey("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"), // Token Extension Program
//     new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"), // Associted Token Program
//     new PublicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s"), // Token Metadata Program
//     new PublicKey("So11111111111111111111111111111111111111112"), // Wrapped SOL
//     new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"), // USDC
//     new PublicKey("Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE"), // MAIN Pool id
//     new PublicKey("EUuUbDcafPrmVTD5M6qoJAoyyNbihBhugADAxRMn5he9"), // MAIN SOL-USDC Pool 1
//     new PublicKey("2WLWEuKDgkDUccTpbwYp1GToYktiSB1cXvreHUwiSUVP"), // MAIN SOL-USDC Pool 2
//     new PublicKey("83v8iPyZihDEjDdY8RdZddyZNyUtXngz69Lgo9Kt5d6d"), // SWAP Pool id
//     new PublicKey("D3CDPQLoa9jY1LXCkpUqd3JQDWz8DX1LDE1dhmJt9fq4"), // SWAP SOL-USDC Pool 1
//     new PublicKey("dwxR9YF7WwnJJu7bPC4UNcWFpcSsooH6fxbpoa3fTbJ"), // SWAP SOL-USDC Pool 2
//     new PublicKey("56HTekCA69upyVDTyvLGVqqnyqTjeTcLAb9hotYXEaJn"), // USDC ATA
//     new PublicKey("38d2DowiQEn1BUxqHWt38yp4pZHjDzU87hynZ7dLnmYJ"), // Main Pool Fee account 1
//     new PublicKey("EpmYr9EDCdiZgPmdfTeEupXMyPoBKbwkPrutSPUJLua"), // Main Pool Fee account 2
//     new PublicKey("FoKYKtRpD25TKzBMndysKpgPqbj8AdLXjfpYHXn9PGTX"), // Main Pool Fee account 3
//     new PublicKey("8HuEEpxfWffdQLYVSa6KNLBQ4iyeUoVhEeUngfPagkpU"), // SWAP Pool Fee account 1
//     new PublicKey("At2e8CBPro2N4Jz2B66xk94HuP8EAqRgzGMbbaEQgTQe"), // SWAP Pool Fee account 2
//     new PublicKey("4VaB9qgWDTy2ChXWoqhcxBPfBchEBwDqxPR7JXiHcMgW"), // SWAP Pool Fee account 3
//     new PublicKey("GwRSc3EPw2fCLJN7zWwcApXgHSrfmj9m4H5sfk1W2SUJ"), // 
//     new PublicKey("3axbTs2z5GBy6usVbNVoqEgZMng3vZvMnAoX29BFfwhr"), //
//     new PublicKey("72hRmKtFyKd2faAAQRio1XtcjebVT7UeiqxjWs212gYC"), // Position 1
//     new PublicKey("DUKs91LB4MiV4Wn8smH2jKswUw82UY4qxCQkDams73tX"), // Position 2
//     new PublicKey("7SvscisPMn7Cxb6QL7bd1jrRKrp5XBPMMowL5vWJWZ4u"), // Position 3
//     new PublicKey("CrKPLNUtHxYX1rjbW5WC7hVTkBNM3zVEurWGV5FjWBDs"), // Position 7
//   ]
// );

// extendALT([
  // new PublicKey("8eLrZGQeqUN9nwGFfhMvrTwxic6TTavuEh47LKAkMC1W"), // position id
  // new PublicKey("4V8c8iUYBNCrykb1D5qm6sdvbqppG8o82JCotajTwya8"),
  // new PublicKey("66qFXVHEWDRyEwydm82azqZMxaP8GH2SFMDGqXNsgL4r"),
  // new PublicKey("HGW6nMVyVoDgLyHyeZdWy2uiYX5evRvLk3zx5o46fGSP"),
  // new PublicKey("ErdzvuYUjAkvo82StCX1AinozCW6XHNZvKPw3Kzi6XeZ"),
  // new PublicKey("Hv9aCrHkyJQFdHdPyLiuj4d3E3H833jzK1VBpEh1QjpP"),
  // new PublicKey("Aw5gjDyvqLf6zRkn5KbEZqiegVm8HCgi2bDwcQPzqmbk"),
  // new PublicKey("6GX2RATiSC9msCZNQmiFxVZzE9Jaoc8qzi6HVLEWco1Y"),
  // new PublicKey("96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5"), // Jito tip account
// ]);