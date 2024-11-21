import { Keypair } from "@solana/web3.js";
import * as fs from "fs";
import bs58 from "bs58";

const keypair = Keypair.generate();
console.log(`Generated new Keypair: Wallet PublicKey: ${keypair.publicKey.toString()}`);

const privateKey = bs58.encode(keypair.secretKey);
console.log(`Wallet PrivateKey: ${privateKey}`);

const secret_array = keypair.secretKey.toString().split(",").map(value => Number(value));
const secret = JSON.stringify(secret_array);

fs.writeFile('main.json', secret, 'utf8', function(err) {
  if (err) throw err;
  console.log(`Wrote to main.json.`);
});
