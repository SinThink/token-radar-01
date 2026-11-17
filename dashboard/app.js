// The dashboard client – thin JS that pulls BOARD_DATA from data.js and renders the table.

(() => {
  const board = BOARD_DATA;
  const tbody = document.getElementById('tbody');
  const rows = board.map(r => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${r.rank}</td>` +
                    `<td>${r.name}</td>` +
                    `<td>$${r.implied_value_usd.toLocaleString()}</td>` +
                    `<td>$${r.tvl_usd.toLocaleString()}</td>` +
                    `<td>${r.multiple.toFixed(2)}</td>` +
                    `<td>${(r.growth_mult-1).toFixed(2)}</td>` +
                    `<td>$${r.band_p10_usd.toLocaleString()}</td>` +
                    `<td>$${r.band_p90_usd.toLocaleString()}</td>` +
                    `<td>${r.farm.verdict}</td>` +
                    `<td>$${r.farm.net_per_hour_point.toFixed(1)}/h</td>` +
                    `<td>${r.watchlist ? '✓' : '&mdash;'}</td>`;
    tr.dataset.slug = r.slug;
    tr.onclick = () => showDetail(r);
    return tr;
  });
  tbody.replaceChildren(...rows);

  function showDetail(row) {
    const detail = document.getElementById('detail');
    const body = document.getElementById('detail-body');
    body.innerHTML = `<h3>${row.name} (${row.slug})</h3>`;
    body.innerHTML += `<p>Implied value: $${row.implied_value_usd.toLocaleString()}</p>`;
    body.innerHTML += `<p>Tagline: ${row.tvl_usd.toLocaleString()} TVL, ${row.change_7d || 0}% change.</p>`;
    body.innerHTML += `<p>Moves (+${row.farm.net_per_hour_point.toFixed(1)}/h @ point)</p>`;
    body.innerHTML += `<ol>${row.farm_steps.map(s=>`<li>${s}</li>`).join('')}</ol>`;
    detail.style.display = 'block';
  }
  document.getElementById('close-detail').onclick = () => document.getElementById('detail').style.display = 'none';
})();
