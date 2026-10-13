/* Customer-facing payment rows and the Finance account each one pays into.

   The customer chooses the bank or wallet at checkout, and createOnlineOrder stamps the Finance
   account linked to that row on the order, so the money posts where it was actually sent. This
   renders the link picker per row in POS Settings and warns when a row is switched on without a
   link, because that payment could not be routed by the customer's own choice.

   It was carved out of assets/js/admin/core.mjs (admin 675) to keep that guarded bundle inside its
   reviewed byte budget. It reads the accounts map the admin shell already subscribes to, so it adds
   no Firebase read of its own. */
export function createPaymentAccountLinks(getAccounts) {
  const rows = [
    {key: 'gcash', type: 'ewallet', select: 'editGcashAccountId', note: 'unlinkedGcashNote', toggle: 'chkGcash'},
    {key: 'bdo', type: 'bank', select: 'editBdoAccountId', note: 'unlinkedBdoNote', toggle: 'chkBdo'},
    {key: 'ub', type: 'bank', select: 'editUbAccountId', note: 'unlinkedUbNote', toggle: 'chkUb'},
    {key: 'maya', type: 'ewallet', select: 'editMayaAccountId', note: 'unlinkedMayaNote', toggle: 'chkMaya'},
    {key: 'bank3', type: 'bank', select: 'editBank3AccountId', note: 'unlinkedBank3Note', toggle: 'chkBank3'},
    {key: 'bank4', type: 'bank', select: 'editBank4AccountId', note: 'unlinkedBank4Note', toggle: 'chkBank4'}
  ];
  let settings = {};
  function paint(row, select, note, toggle, missing) {
    if (!note) return;
    const on = !toggle || toggle.checked;
    if (missing) {
      note.textContent = '⚠️ The linked account is missing or inactive — a customer paying this way would be refused. Link the real account.';
      note.style.display = on ? 'block' : 'none';
      return;
    }
    note.textContent = '⚠️ Offered to customers but not linked — the customer\'s own choice cannot be routed until you link it.';
    note.style.display = on && !select.value ? 'block' : 'none';
  }
  return {
    render(current) {
      if (current) settings = current;
      const accounts = (typeof getAccounts === 'function' ? getAccounts() : null) || {};
      rows.forEach((row) => {
        const select = document.getElementById(row.select);
        if (!select) return;
        const chosen = String(settings[row.key + 'AccountId'] || '');
        const ids = Object.keys(accounts)
          .filter((id) => {const a = accounts[id] || {}; return a.active !== false && String(a.type || 'bank') === row.type;})
          .sort((a, b) => String(accounts[a].name || a).localeCompare(String(accounts[b].name || b)));
        select.textContent = '';
        const blank = document.createElement('option');
        blank.value = '';
        blank.textContent = '— not linked —';
        select.appendChild(blank);
        ids.forEach((id) => {
          const option = document.createElement('option');
          option.value = id;
          option.textContent = String(accounts[id].name || id);
          if (id === chosen) option.selected = true;
          select.appendChild(option);
        });
        // A link whose account is gone keeps its value, so saving the form cannot silently wipe it.
        const missing = Boolean(chosen) && ids.indexOf(chosen) < 0;
        if (missing) {
          const stale = document.createElement('option');
          stale.value = chosen;
          stale.textContent = chosen + ' (missing or inactive)';
          stale.selected = true;
          select.appendChild(stale);
        }
        const note = document.getElementById(row.note), toggle = document.getElementById(row.toggle);
        paint(row, select, note, toggle, missing);
        select.onchange = () => paint(row, select, note, toggle, false);
        // Marked once the select really holds the stored value. savePayment writes the whole
        // /payment object, so a select that was never hydrated must not be read as "not linked":
        // values() returns the stored link instead of silently wiping it.
        select.setAttribute('data-hydrated', '1');
      });
    },
    /* Every link key, always: the payment form saves the complete object, so an omitted key would
       delete the link rather than leave it alone. */
    values() {
      const out = {};
      rows.forEach((row) => {
        const select = document.getElementById(row.select);
        out[row.key + 'AccountId'] = select && select.getAttribute('data-hydrated') === '1'
          ? select.value
          : String(settings[row.key + 'AccountId'] || '');
      });
      return out;
    }
  };
}
