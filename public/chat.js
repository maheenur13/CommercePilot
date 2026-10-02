// Demo client for the assistant API. Model output is untrusted: it is only ever set via
// textContent, never parsed as HTML (a test enforces this).
(() => {
  // Public demo tokens from fixtures/customers.json (also listed in RUN.md).
  const PERSONAS = [
    { label: 'Anonymous', token: null },
    { label: 'Alice (demo customer)', token: 'demo-alice-7f3k9q2m5x8v1b4n' },
    { label: 'Bob (demo customer)', token: 'demo-bob-2p6r8t0w3y5u7i9o' },
    { label: 'Carol (demo customer)', token: 'demo-carol-4h6j8l1z3c5v7n9m' },
    { label: 'Dan (demo customer)', token: 'demo-dan-9a1s3d5f7g2h4j6k' },
  ];

  const $ = (id) => document.getElementById(id);
  const log = $('log');
  const form = $('form');
  const input = $('input');
  const send = $('send');
  const who = $('who');
  let conversationId;

  PERSONAS.forEach((p, i) => who.add(new Option(p.label, String(i))));

  function add(className, text) {
    const el = document.createElement('div');
    el.className = `msg ${className}`;
    el.textContent = text;
    log.append(el);
    log.scrollTop = log.scrollHeight;
    return el;
  }

  function addCited(el, products) {
    if (!products.length) return;
    const box = document.createElement('div');
    box.className = 'cited';
    for (const p of products) {
      const chip = document.createElement('span');
      chip.className = 'chip';
      chip.textContent = `${p.name} · ${p.price.formatted}${p.inStock ? '' : ' · out of stock'}`;
      box.append(chip);
    }
    el.append(box);
  }

  const FINAL_QUOTE_ERRORS = new Set([
    'QUOTE_NOT_FOUND',
    'QUOTE_EXPIRED',
    'PRICE_CHANGED',
    'INSUFFICIENT_STOCK',
  ]);
  const lineText = (i) => `${i.quantity} × ${i.name} @ ${i.unitPrice.formatted}`;

  // Only this button places an order: it sends the server-issued quote id back. The model can't.
  function addQuote(el, quote) {
    const box = document.createElement('div');
    box.className = 'quote';
    const list = document.createElement('ul');
    for (const i of quote.items) {
      const li = document.createElement('li');
      li.textContent = lineText(i);
      list.append(li);
    }
    const total = document.createElement('div');
    total.textContent = `Total ${quote.total.formatted} · valid until ${new Date(quote.expiresAt).toLocaleTimeString()}`;
    const confirm = document.createElement('button');
    confirm.className = 'primary';
    confirm.type = 'button';
    confirm.textContent = `Confirm order (${quote.total.formatted})`;
    confirm.addEventListener('click', async () => {
      confirm.disabled = true;
      if (!(await post({ confirmQuoteId: quote.quoteId }, 'Confirm order')))
        confirm.disabled = false;
    });
    box.append(list, total, confirm);
    el.append(box);
  }

  function addOrder(el, order) {
    const box = document.createElement('div');
    box.className = 'quote';
    box.textContent = `Order ${order.id} · ${order.status} · ${order.total.formatted}`;
    el.append(box);
  }

  /** Sends one turn; returns true on success, else the error code (or undefined). */
  async function post(payload, userText) {
    add('user', userText);
    send.disabled = true;
    const { token } = PERSONAS[Number(who.value)];
    try {
      const res = await fetch('/api/v1/assistant/chat', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(token && { authorization: `Bearer ${token}` }),
        },
        body: JSON.stringify(conversationId ? { conversationId, ...payload } : payload),
      });
      const body = await res.json();
      if (!body.success) {
        add('error', `${body.error.code}: ${body.error.message}`);
        return body.error.code;
      }
      conversationId = body.data.conversationId;
      const el = add('assistant', body.data.reply);
      addCited(el, body.data.citedProducts);
      if (body.data.pendingOrder) addQuote(el, body.data.pendingOrder);
      if (body.data.placedOrder) addOrder(el, body.data.placedOrder);
      return true;
    } catch (err) {
      add('error', `Request failed: ${err.message}`);
      return undefined;
    } finally {
      send.disabled = false;
      input.focus();
    }
  }

  // A conversation belongs to whoever started it, so switching persona starts a new one.
  function reset() {
    conversationId = undefined;
    log.querySelectorAll('.msg').forEach((el) => el.remove());
  }
  who.addEventListener('change', reset);
  $('reset').addEventListener('click', reset);

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      form.requestSubmit();
    }
  });

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const message = input.value.trim();
    if (!message) return;
    input.value = '';
    void post({ message }, message);
  });
})();
