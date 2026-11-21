import { writeFileSync } from 'node:fs';
import { nativeToScVal, SorobanDataBuilder, xdr } from '@stellar/stellar-sdk';

const map = (fields) =>
  xdr.ScVal.scvMap(
    Object.entries(fields).map(
      ([key, val]) => new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol(key), val }),
    ),
  );

const retval = map({
  id: nativeToScVal(18446744073709551615n, { type: 'u64' }),
  amount: nativeToScVal(9007199254740993n, { type: 'i128' }),
  safeCount: nativeToScVal(9007199254740991n, { type: 'u64' }),
  status: xdr.ScVal.scvVec([xdr.ScVal.scvSymbol('Active')]),
  optional: nativeToScVal(99, { type: 'u64' }),
  absent: xdr.ScVal.scvVoid(),
  nested: map({
    maybe: nativeToScVal(7, { type: 'u64' }),
    absent: xdr.ScVal.scvVoid(),
    status: xdr.ScVal.scvVec([xdr.ScVal.scvSymbol('Released')]),
    values: xdr.ScVal.scvVec([
      xdr.ScVal.scvString('a'),
      xdr.ScVal.scvString('b'),
    ]),
  }),
});

const response = {
  id: 'synthetic-read-fixture',
  latestLedger: 123456,
  transactionData: new SorobanDataBuilder().build().toXDR('base64'),
  events: [],
  minResourceFee: '0',
  results: [{ auth: [], xdr: retval.toXDR('base64') }],
};

writeFileSync(
  new URL('./soroban-read-response.json', import.meta.url),
  `${JSON.stringify(response, null, 2)}\n`,
);