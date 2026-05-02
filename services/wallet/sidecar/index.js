import express from 'express';
import { createClient } from 'tigerbeetle-node';

const PORT = parseInt(process.env.PORT ?? '8080', 10);
const TB_ADDRESS = process.env.TIGERBEETLE_ADDRESS ?? 'localhost:3000';
const CLUSTER_ID = BigInt(process.env.TIGERBEETLE_CLUSTER_ID ?? '0');

// Reserved account IDs
const ESCROW_ID = BigInt('1');
const HOUSE_ID = BigInt('2');

let tb;

async function init() {
  tb = await createClient({ cluster_id: CLUSTER_ID, replica_addresses: [TB_ADDRESS] });

  // Ensure system accounts exist (idempotent — TigerBeetle ignores duplicates)
  await tb.createAccounts([
    { id: ESCROW_ID, ledger: 1, code: 100, flags: 0n, debits_pending: 0n, debits_posted: 0n, credits_pending: 0n, credits_posted: 0n, user_data_128: 0n, user_data_64: 0n, user_data_32: 0, timestamp: 0n },
    { id: HOUSE_ID,  ledger: 1, code: 101, flags: 0n, debits_pending: 0n, debits_posted: 0n, credits_pending: 0n, credits_posted: 0n, user_data_128: 0n, user_data_64: 0n, user_data_32: 0, timestamp: 0n },
  ]);
}

const app = express();
app.use(express.json());

function hexToBigInt(hex) {
  return BigInt('0x' + hex.replace(/-/g, '').padStart(32, '0'));
}

app.post('/accounts', async (req, res) => {
  const { id, ledger = 1, code = 1 } = req.body;
  const errors = await tb.createAccounts([{
    id: hexToBigInt(id),
    ledger,
    code,
    flags: 0n,
    debits_pending: 0n, debits_posted: 0n,
    credits_pending: 0n, credits_posted: 0n,
    user_data_128: 0n, user_data_64: 0n, user_data_32: 0,
    timestamp: 0n,
  }]);
  res.status(201).json({ errors });
});

app.get('/accounts/:id', async (req, res) => {
  const accounts = await tb.lookupAccounts([hexToBigInt(req.params.id)]);
  if (!accounts.length) return res.status(404).json({ error: 'not found' });
  const a = accounts[0];
  res.json({
    id: req.params.id,
    credits_posted: Number(a.credits_posted),
    debits_posted: Number(a.debits_posted),
  });
});

app.post('/transfers', async (req, res) => {
  const { id, debit_account_id, credit_account_id, amount, code = 1, user_data_128 } = req.body;
  const debitId  = debit_account_id  === 'escrow' ? ESCROW_ID : debit_account_id  === 'house' ? HOUSE_ID : hexToBigInt(debit_account_id);
  const creditId = credit_account_id === 'escrow' ? ESCROW_ID : credit_account_id === 'house' ? HOUSE_ID : hexToBigInt(credit_account_id);

  const errors = await tb.createTransfers([{
    id: hexToBigInt(id),
    debit_account_id: debitId,
    credit_account_id: creditId,
    amount: BigInt(amount),
    pending_id: 0n,
    user_data_128: user_data_128 ? hexToBigInt(user_data_128) : 0n,
    user_data_64: 0n,
    user_data_32: 0,
    timeout: 0,
    ledger: 1,
    code,
    flags: 0n,
    timestamp: 0n,
  }]);
  res.status(201).json({ errors });
});

init()
  .then(() => app.listen(PORT, () => console.log(`Sidecar listening on :${PORT}`)))
  .catch((e) => { console.error('TigerBeetle init failed', e); process.exit(1); });
