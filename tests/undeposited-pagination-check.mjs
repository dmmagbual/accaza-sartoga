import fs from 'node:fs';

const read=(path)=>fs.readFileSync(path,'utf8');
const server=read('src/functions/21a-undeposited-pages.js');
const finance=read('src/functions/40-sales-finance.js')+read('src/functions/40a-custody-pool.js')+read('src/functions/42d-financial-command-close.js');
const client=read('assets/js/admin/undeposited.js');
const hub=read('assets/js/admin/realtime-hub.mjs');
const rules=read('database.rules.json');
function ok(value,message){if(!value)throw new Error(message);}

ok(server.includes('const UNDEPOSITED_PAGE_SIZE = 25'),'Server page size must remain 25');
ok(client.includes('var PAGE_SIZE=25'),'Client page size must remain 25');
ok(server.includes('limitToLast(UNDEPOSITED_PAGE_SIZE + (cursor ? 2 : 1))'),'Cursor pages need a look-ahead after excluding the inclusive cursor');
ok(server.includes('rows = rows.filter((row) => !(Number(row[field]) === cursor.value && row.id === cursor.id))'),'Inclusive cursor must be removed to prevent duplicates');
ok(server.includes('remove_neutral_legacy_correction_from_undeposited_projection')&&server.includes('neutralLegacyIds'),'Verified zero-net legacy corrections must self-remove from the operational Undeposited projection without deleting Finance Books history');
for(const marker of ['undepositedLedgerPageIndex','cashCustodyOpenIndex','pettyVoucherAttentionIndex','syncUndepositedLedgerPageIndex','syncPettyVoucherAttentionIndex'])ok(server.includes(marker),`Missing compact projection safeguard: ${marker}`);
ok(server.includes('async function verifyPendingVoucherIndex')&&server.includes('stalePendingVoucherIds')&&server.includes('!stalePendingVoucherIds.includes(row.id)'),'Pending voucher attention must recheck bounded authoritative voucher rows before showing an approval warning');
ok(!server.includes('exports.syncCashCustodyPageIndex = onValueWritten'),'The stale custody projection trigger must stay removed; financial writes update custody and its projection atomically.');
for(const marker of ['"undepositedLedgerPageIndex"','"cashCustodyOpenIndex"','"pettyVoucherAttentionIndex"','"undepositedPageIndexMeta"'])ok(rules.includes(marker),`Protected rules node missing: ${marker}`);
ok(!client.includes("subscribe('financialMovements'")&&!client.includes("subscribe('cashCustody'")&&!client.includes("subscribe('pettyCashVouchers'"),'Undeposited UI must not restore broad collection subscriptions');
ok(!hub.includes("pettyCashVouchers:['petty','purchases','undeposited']")&&!hub.includes("cashCustody:['cashflow','undeposited']")&&!hub.includes("'saleshistory','undeposited','discrepancy'"),'Undeposited scope must not reactivate broad shared listeners');
ok(client.includes("firstPage('ledger',ledger)")&&client.includes("firstPage('custody',custody)")&&client.includes("previousPage(ledger)")&&client.includes("nextPage('custody',custody)"),'Both cards need independent Previous and Next paging');
ok(client.includes("payload.from=rangeFrom;payload.to=rangeTo"),'Date changes must request a fresh server-filtered ledger page');
ok(client.includes("state.requestId!==requestId"),'Late page responses must not overwrite a newer date or page request');
ok(client.includes("getUndepositedPage({kind:'voucher'")&&server.includes('kind === "voucher"'),'Voucher evidence must load only when View is selected');
ok(finance.includes('async function poolCustodyDeposit')&&finance.includes('amount(data.amount)')&&client.includes("action:'cash_deposit'")&&client.includes('amount:amount')&&!client.includes('custodyAllocations:allocations'),'Paginated deposits must allocate complete custody FIFO on the server');
ok(finance.includes('CashJournalEdit.assertCustodyDelta'),'Server deposit must retain the concurrent custody-change guard');
ok(finance.includes('cashDepositReferences')&&finance.includes('financialCommandClaims'),'Deposit must retain reference and command idempotency claims');
ok(client.includes('All-time server control · not a page subtotal')&&client.includes('The total above covers all custody records, not only this page.'),'Visible pages must not be presented as all-time totals');
console.log('PASS: Undeposited Collection uses independent 25-record cursor pages, compact reads, and server-authoritative deposits.');
