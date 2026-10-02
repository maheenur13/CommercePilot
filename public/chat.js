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

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const message = input.value.trim();
    if (!message) return;
    add('user', message);
    input.value = '';
    send.disabled = true;

    const { token } = PERSONAS[Number(who.value)];
    try {
      const res = await fetch('/api/v1/assistant/chat', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(token && { authorization: `Bearer ${token}` }),
        },
        body: JSON.stringify(conversationId ? { conversationId, message } : { message }),
      });
      const body = await res.json();
      if (!body.success) {
        add('error', `${body.error.code}: ${body.error.message}`);
        return;
      }
      conversationId = body.data.conversationId;
      addCited(add('assistant', body.data.reply), body.data.citedProducts);
    } catch (err) {
      add('error', `Request failed: ${err.message}`);
    } finally {
      send.disabled = false;
      input.focus();
    }
  });
})();
