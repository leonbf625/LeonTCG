var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// exports.js
var MAX_EXPORT_BYTES = 8e6;
var id = /* @__PURE__ */ __name((value) => typeof value === "string" && /^\d{1,22}$/.test(value), "id");
var date = /* @__PURE__ */ __name((value) => typeof value === "string" && Number.isFinite(Date.parse(value)), "date");
var object = /* @__PURE__ */ __name((value) => value !== null && typeof value === "object" && !Array.isArray(value), "object");
function validateExport(data) {
  if (!object(data) || !object(data.guild) || !object(data.channel) || !Array.isArray(data.messages)) return "Expected guild, channel and messages array";
  if (!id(data.guild.id) || !id(data.channel.id)) return "Guild and channel IDs must be numeric strings";
  if (typeof data.guild.name !== "string" || typeof data.channel.name !== "string" || data.guild.name.length > 256 || data.channel.name.length > 256) return "Invalid guild or channel name";
  if (data.messageCount !== void 0 && (!Number.isSafeInteger(data.messageCount) || data.messageCount !== data.messages.length)) return "messageCount must match the actual messages array";
  if (data.exportedAt !== void 0 && !date(data.exportedAt)) return "Invalid exportedAt timestamp";
  for (const message of data.messages) {
    if (!object(message) || !id(message.id) || !date(message.timestamp) || typeof message.content !== "string") return "Invalid message ID, timestamp or content";
  }
  return null;
}
__name(validateExport, "validateExport");
function reply(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
}
__name(reply, "reply");
function shortName(value) {
  let result = "";
  for (const character of value) {
    if (new TextEncoder().encode(result + character).length > 120) break;
    result += character;
  }
  return result;
}
__name(shortName, "shortName");
async function receiveExport(request, storage) {
  if (!(request.headers.get("Content-Type") || "").toLowerCase().startsWith("application/json")) return reply({ error: "Content-Type must be application/json" }, 415);
  if (Number(request.headers.get("Content-Length")) > MAX_EXPORT_BYTES) return reply({ error: "Export exceeds 8 MB; use the partitioning uploader" }, 413);
  const reader = request.body?.getReader();
  if (!reader) return reply({ error: "Empty request" }, 400);
  const parts = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > MAX_EXPORT_BYTES) {
      await reader.cancel();
      return reply({ error: "Export exceeds 8 MB; use the partitioning uploader" }, 413);
    }
    parts.push(value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.byteLength;
  }
  let data;
  try {
    data = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    return reply({ error: "Invalid JSON or UTF-8" }, 400);
  }
  const invalid = validateExport(data);
  if (invalid) return reply({ error: invalid }, 400);
  const digest = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), (byte) => byte.toString(16).padStart(2, "0")).join("");
  const claimed = request.headers.get("Idempotency-Key");
  if (claimed && claimed !== digest) return reply({ error: "Idempotency-Key does not match the request SHA-256" }, 400);
  const key = `export:${data.channel.id}:${digest}`;
  const metadata = {
    key,
    guild: shortName(data.guild.name),
    channel: shortName(data.channel.name),
    channelId: data.channel.id,
    messageCount: data.messages.length,
    exportedAt: data.exportedAt ?? null,
    receivedAt: (/* @__PURE__ */ new Date()).toISOString(),
    sha256: digest,
    bytes: length
  };
  await storage.put(key, new TextDecoder().decode(bytes), { metadata });
  return reply({ ok: true, success: true, message: "Export received and saved", key, channel: data.channel.name, messages: data.messages.length, sha256: digest });
}
__name(receiveExport, "receiveExport");
async function listExports(request, storage) {
  const url = new URL(request.url), channelId = url.searchParams.get("channelId");
  if (channelId !== null && !id(channelId)) return reply({ error: "Invalid channelId" }, 400);
  const limit = Number(url.searchParams.get("limit") || 20);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) return reply({ error: "limit must be 1 to 100" }, 400);
  const page = await storage.list({ prefix: channelId ? `export:${channelId}:` : "export:", limit, cursor: url.searchParams.get("cursor") || void 0 });
  const entries = [];
  for (const record of page.keys) {
    if (record.metadata) {
      entries.push({ ...record.metadata, key: record.name });
      continue;
    }
    try {
      const raw = await storage.get(record.name);
      if (!raw) continue;
      const data = JSON.parse(raw);
      entries.push({
        key: record.name,
        guild: data.guild?.name || "Unknown",
        channel: data.channel?.name || "Unknown",
        channelId: data.channel?.id || null,
        messageCount: Array.isArray(data.messages) ? data.messages.length : 0,
        exportedAt: data.exportedAt || null,
        receivedAt: null,
        legacy: true
      });
    } catch {
      entries.push({ key: record.name, error: "Stored export could not be read" });
    }
  }
  return reply({
    exports: entries,
    cursor: page.list_complete ? null : page.cursor,
    note: "KV pages are ordered by channel/key, not upload time. All stored exports are retained; no automatic deletion is performed."
  });
}
__name(listExports, "listExports");
async function downloadExport(encoded, storage) {
  let key;
  try {
    key = decodeURIComponent(encoded);
  } catch {
    return reply({ error: "Invalid export key" }, 400);
  }
  if (!/^export:\d{1,22}:(?:[a-f0-9]{64}|\d{10,16})$/.test(key)) return reply({ error: "Invalid export key" }, 400);
  const value = await storage.get(key);
  if (value === null) return reply({ error: "Export not found" }, 404);
  return new Response(value, { headers: { "Content-Type": "application/json; charset=utf-8", "Content-Disposition": `attachment; filename="discord-${key.split(":")[1]}.json"`, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
}
__name(downloadExport, "downloadExport");

// inline-assets.js
var inlineAssets = { "/": { "body": '<!doctype html>\n<html lang="en">\n<head>\n  <meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">\n  <meta name="color-scheme" content="dark">\n  <title>Discord Backup \xB7 Coverage</title>\n  <link rel="stylesheet" href="/style.css"><script src="/app.js" defer><\/script>\n</head>\n<body>\n<div class="shell">\n  <header><div class="brand"><span class="mark">D</span><span>DISCORD BACKUP <small>PRIVATE ARCHIVE</small></span></div><span id="mode" class="pill">Connecting</span></header>\n  <main>\n    <section class="intro"><div><p class="eyebrow">YOUR CHANNELS, ACCOUNTED FOR</p><h1>A clearer view of<br>what\u2019s backed up.</h1><p class="muted">See which channels were checked, what\u2019s still pending, and when the last scan ran.</p></div><div class="account"><span class="muted">DISCORD ACCOUNT IN THIS BACKUP</span><strong id="account">Not connected</strong><span id="account-id" class="muted">Connect locally to verify the account ID.</span></div></section>\n    <div id="error" class="error" role="alert" hidden></div>\n    <section id="local-controls" class="panel" hidden>\n      <div class="section-title"><h2>Local scanner</h2><span class="muted">Credentials stay in this running app</span></div>\n      <form id="settings">\n        <div class="fields"><label>Discord token<input id="discord-token" type="password" autocomplete="off" placeholder="Entered locally; never uploaded"></label><label>Backup folder<input id="folder" placeholder="Loading default folder\u2026"></label></div>\n        <div class="checks"><label><input id="bot" type="checkbox"> Bot token</label><label><input id="attachments" type="checkbox" checked> Download attachments</label><label><input id="auto" type="checkbox" checked> Auto scan</label><label>Every <input id="interval" type="number" min="5" max="1440" value="15" class="short"> minutes</label></div>\n        <details><summary>Automatically update a private Cloudflare website</summary><div class="fields"><label>Website URL<input id="website" type="url" placeholder="https://your-dashboard.workers.dev"></label><label>Website upload token<input id="upload-token" type="password" autocomplete="off" placeholder="Separate from your Discord token"></label></div><p class="muted">Uploads channel coverage and the newest 200 message texts. Full history and attachment files stay on this PC.</p></details>\n        <div class="actions"><button id="discover" type="button">Find channels</button><button id="start" type="submit" class="primary">Start backup</button><button id="stop" type="button">Stop safely</button><label><input id="all-channels" type="checkbox"> All discovered channels, including new ones</label></div>\n        <p class="notice">Personal-account automation uses an unsupported Discord route and can risk suspension. Normal Discord OAuth sign-in does not grant message-history access. Only archive channels you are authorized to read.</p>\n      </form>\n    </section>\n    <section class="stats" aria-label="Backup coverage">\n      <div><span>DISCOVERED</span><strong id="total">0</strong><small>Known channels</small></div><div><span>CHECKED</span><strong id="checked">0</strong><small>Includes failed attempts</small></div><div><span>UNCHECKED</span><strong id="unchecked">0</strong><small>Awaiting a first check</small></div><div><span>FAILED</span><strong id="failed">0</strong><small>Needs attention</small></div>\n    </section>\n    <section class="panel">\n      <div class="section-title"><div><h2>Channel coverage</h2><p id="freshness" class="muted">No scan data yet. Nothing has been claimed as checked.</p></div><button id="refresh">Refresh</button></div>\n      <div class="filters"><input id="filter-text" placeholder="Search server, channel or ID" aria-label="Search channels"><select id="filter-status" aria-label="Filter coverage"><option>All channels</option><option>Unchecked</option><option>Checked</option><option>Failed</option><option>History backed up</option></select><button id="select-visible" hidden>Select visible</button></div>\n      <div class="table-wrap"><table><thead><tr><th id="selection-heading" hidden>Select</th><th>SERVER / CHANNEL</th><th>CHECKED?</th><th>RESULT</th><th>LAST CHECKED</th><th>SAVED</th></tr></thead><tbody id="channels"></tbody></table></div><p id="empty" class="empty">No channel data yet.</p>\n      <p class="notice">\u201CChecked\u201D means a history request ended, including a failed or paused attempt. \u201CHistory backed up\u201D means the API history was exhausted for that run; attachment failures and discovery gaps can still remain.</p>\n    </section>\n    <section class="panel"><div class="section-title"><h2>Recent messages</h2><span class="muted">Latest 200 in the archive</span></div><input id="message-search" placeholder="Search recent message text" aria-label="Search recent messages"><div id="messages"></div><p class="notice">Full message history and attachment files remain in the Windows backup folder. Old edits are not refreshed automatically.</p></section>\n    <section id="log-panel" class="panel" hidden><div class="section-title"><h2>Scanner activity</h2><span id="scanner-status" class="muted">Idle</span></div><pre id="logs">No operations yet.</pre><div class="actions"><button id="export-prompt">Export DeepSeek prompt</button><label><input id="prompt-messages" type="checkbox"> Include message excerpts</label></div><p class="notice">Exports selected channels, or all known channels when none are selected. Creates a local Markdown file; nothing is sent to DeepSeek. Known credentials are redacted, but review private content before uploading.</p></section>\n    <section id="exporter-panel" class="panel" hidden>\n      <div class="section-title"><h2>DiscordChatExporter uploads</h2><span class="muted">Private JSON archive</span></div>\n      <div class="actions"><input id="export-file" type="file" accept=".json,application/json" aria-label="Choose DiscordChatExporter JSON"><button id="upload-export">Upload JSON</button></div>\n      <p class="notice">Choose JSON exported from DiscordChatExporter, not a program/source ZIP. Browser uploads support 8 MB. The Windows folder uploader partitions larger files and resumes uploads. Attachment files are not uploaded; their JSON references are preserved.</p>\n      <div class="table-wrap"><table><thead><tr><th>SERVER / CHANNEL</th><th>MESSAGES</th><th>EXPORTED</th><th>RECEIVED</th><th>FILE</th></tr></thead><tbody id="saved-exports"></tbody></table></div>\n      <button id="more-exports" hidden>Load more exports</button><p id="export-note" class="notice">No exports loaded.</p>\n    </section>\n    <footer><span>Local-first storage. Private by default.</span><span id="updated">Waiting for data</span></footer>\n  </main>\n</div>\n</body></html>\n', "type": "text/html; charset=utf-8" }, "/app.js": { "body": `"use strict";
const $ = id => document.getElementById(id);
let local = false, report = {channels: [], recent_messages: []}, busy = false;
const selected = new Set();
const fragment = new URLSearchParams(location.hash.slice(1));
if (fragment.has("key")) {
  sessionStorage.setItem("backup-local-key", fragment.get("key"));
  history.replaceState(null, "", location.pathname);
}
const localKey = sessionStorage.getItem("backup-local-key") || "";
let credentialHeld = false;
let exportCursor = null, exportRows = [];

async function loadExports(reset = true) {
  if (local) return;
  const value = await api('/api/exports' + (!reset && exportCursor ? '?cursor=' + encodeURIComponent(exportCursor) : ''));
  exportRows = reset ? value.exports : [...exportRows, ...value.exports];
  exportCursor = value.cursor;
  const table = $('saved-exports'); table.replaceChildren();
  for (const entry of exportRows) {
    const row = element('tr'), label = element('td', entry.channel || 'Unknown channel');
    label.append(element('small', entry.guild || 'Unknown server'));
    row.append(label, element('td', entry.messageCount ?? 'Unknown'), element('td', entry.exportedAt ? date(entry.exportedAt) : 'Unknown'), element('td', entry.receivedAt ? date(entry.receivedAt) : 'Unknown'));
    const cell = element('td'), link = element('a', 'Download JSON');
    link.href = '/api/exports/' + encodeURIComponent(entry.key); cell.append(link); row.append(cell); table.append(row);
  }
  $('more-exports').hidden = !exportCursor;
  $('export-note').textContent = \`\${exportRows.length} exports loaded. \${value.note || ''}\`;
}

async function api(path, value) {
  const options = {headers: {"X-Local-Key": localKey}, credentials: "same-origin", cache: "no-store"};
  if (value !== undefined) {
    options.method = "POST";
    options.headers["Content-Type"] = "application/json";
    options.body = JSON.stringify(value);
  }
  const response = await fetch(path, options);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || \`Request failed (\${response.status})\`);
  return body;
}

function fail(error) { $("error").textContent = error.message || String(error); $("error").hidden = false; }
function date(value) { return value ? new Date(value).toLocaleString() : "Never"; }
function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}
function visibleChannels() {
  const search = $("filter-text").value.toLowerCase(), filter = $("filter-status").value;
  return (report.channels || []).filter(channel => {
    const checked = Boolean(channel.last_checked_at);
    return \`\${channel.guild || ""} \${channel.channel} \${channel.id}\`.toLowerCase().includes(search) &&
      (filter !== "Unchecked" || !checked) && (filter !== "Checked" || checked) &&
      (filter !== "Failed" || channel.status === "failed") &&
      (filter !== "History backed up" || channel.status === "history backed up");
  });
}
function renderChannels() {
  const target = $("channels"); target.replaceChildren();
  const visible = visibleChannels();
  $("empty").hidden = visible.length > 0;
  for (const channel of visible) {
    const row = element("tr");
    if (local) {
      const cell = element("td"), checkbox = element("input");
      checkbox.type = "checkbox"; checkbox.checked = selected.has(channel.id);
      checkbox.setAttribute("aria-label", \`Select \${channel.channel}\`);
      checkbox.addEventListener("change", () => checkbox.checked ? selected.add(channel.id) : selected.delete(channel.id));
      cell.append(checkbox); row.append(cell);
    }
    const label = element("td", channel.channel);
    label.append(element("small", \`\${channel.guild || "Unknown server"} \xB7 \${channel.id}\`));
    row.append(label, element("td", channel.last_checked_at ? "Yes" : "No"));
    const result = element("td"), status = channel.status || "not started";
    const style = status === "history backed up" ? "success" : status === "failed" ? "failed" : "pending";
    result.append(element("span", status, \`badge \${style}\`));
    if (channel.error) result.append(element("small", channel.error));
    if (channel.attachment_errors) result.append(element("small", \`\${channel.attachment_errors} attachment errors\`));
    row.append(result, element("td", date(channel.last_checked_at)), element("td", Number(channel.messages || 0).toLocaleString()));
    target.append(row);
  }
}
function renderMessages() {
  const target = $("messages"); target.replaceChildren();
  const search = $("message-search").value.toLowerCase();
  const channels = new Map((report.channels || []).map(channel => [channel.id, channel]));
  const messages = (report.recent_messages || []).filter(message => message.content.toLowerCase().includes(search));
  for (const message of messages) {
    const channel = channels.get(message.channel_id);
    const article = element("article", undefined, "message");
    const meta = element("div");
    meta.append(element("strong", message.author), element("span", \`\${channel?.guild || ""} / \${channel?.channel || message.channel_id}\`, "muted"));
    article.append(meta, element("small", date(message.timestamp)), element("p", message.content || "[No text content]"));
    target.append(article);
  }
  if (!messages.length) target.append(element("p", "No recent messages match.", "empty"));
}
function render() {
  const channels = report.channels || [];
  $("total").textContent = channels.length;
  $("checked").textContent = channels.filter(channel => channel.last_checked_at).length;
  $("unchecked").textContent = channels.filter(channel => !channel.last_checked_at).length;
  $("failed").textContent = channels.filter(channel => channel.status === "failed").length;
  $("account").textContent = report.account?.username || "Not connected";
  $("account-id").textContent = report.account ? \`Account ID: \${report.account.id}\` : "Connect locally to verify the account ID.";
  $("freshness").textContent = report.created_at ? \`Report updated \${date(report.created_at)} \xB7 Times shown in your browser\u2019s time zone.\` : "No scan data yet. Nothing has been claimed as checked.";
  $("updated").textContent = report.uploaded_at ? \`Website synced \${date(report.uploaded_at)}\` : "Archive stays on your computer";
  renderChannels(); renderMessages();
}
async function refresh() {
  report = await api("/api/report"); render();
  if (local) {
    const state = await api("/api/state");
    busy = state.busy; credentialHeld = state.credential_held;
    $("scanner-status").textContent = state.status + (state.next_scan ? \` \xB7 Next scan \${date(state.next_scan)}\` : "");
    $("logs").textContent = (state.logs || []).join("\\n") || "No operations yet.";
    $("discover").disabled = busy; $("start").disabled = busy;
  } else await loadExports();
}
function settings() {
  const token = $("discord-token").value;
  if (!token && !credentialHeld) throw new Error("Enter the Discord token locally to connect.");
  if (!$("folder").value.trim()) throw new Error("Choose a backup folder.");
  return {token, bot: $("bot").checked, folder: $("folder").value,
    attachments: $("attachments").checked, auto: $("auto").checked,
    interval: Number($("interval").value), website: $("website").value,
    upload_token: $("upload-token").value, all_channels: $("all-channels").checked,
    selected: [...selected]};
}
async function action(path, value) {
  $("error").hidden = true;
  try {
    await api(path, value);
    $("discord-token").value = ""; $("upload-token").value = "";
    await refresh();
  } catch (error) { fail(error); }
}
$("settings").addEventListener("submit", event => {
  event.preventDefault();
  try { action("/api/start", settings()); } catch (error) { fail(error); }
});
$("discover").addEventListener("click", () => {try {action("/api/discover", settings());} catch(error) {fail(error);}});
$("stop").addEventListener("click", () => action("/api/stop", {}));
$("select-visible").addEventListener("click", () => {for (const channel of visibleChannels()) selected.add(channel.id); renderChannels();});
$("refresh").addEventListener("click", () => refresh().catch(fail));
$("filter-text").addEventListener("input", renderChannels);
$("filter-status").addEventListener("change", renderChannels);
$("message-search").addEventListener("input", renderMessages);
$('more-exports').addEventListener('click', () => loadExports(false).catch(fail));
$('upload-export').addEventListener('click', async () => {
  const file = $('export-file').files[0];
  if (!file) return fail(new Error('Choose a DiscordChatExporter JSON file first.'));
  if (file.size > 8000000) return fail(new Error('File exceeds 8 MB. Use the Windows partitioning uploader.'));
  $('upload-export').disabled = true;
  try {
    const response = await fetch('/api/exports', {method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:file});
    const value = await response.json();
    if (!response.ok) throw new Error(value.error || \`Upload failed (\${response.status})\`);
    $('error').hidden = true; await loadExports();
  } catch(error) {fail(error);} finally {$('upload-export').disabled = false;}
});
$("export-prompt").addEventListener("click", async () => {
  try {
    const response = await fetch('/api/export-prompt', {method:'POST', headers:{'X-Local-Key':localKey,'Content-Type':'application/json'}, body:JSON.stringify({selected:[...selected],include_messages:$("prompt-messages").checked})});
    if (!response.ok) {const value=await response.json();throw new Error(value.error || 'Prompt export failed');}
    const file = await response.blob(), url=URL.createObjectURL(file), link=element('a');
    link.href=url;link.download='deepseek-discord-backup-prompt.md';link.click();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
  } catch(error) {fail(error);}
});
(async () => {
  const mode = await api("/api/mode"); local = mode.local;
  $("mode").textContent = local ? "ON THIS COMPUTER" : "PRIVATE CLOUD DASHBOARD";
  for (const id of ["local-controls", "log-panel", "selection-heading", "select-visible"]) $(id).hidden = !local;
  $('exporter-panel').hidden = local;
  if (local) $("folder").value = mode.default_folder;
  await refresh();
  setInterval(() => refresh().catch(fail), local ? 4000 : 60000);
})().catch(fail);
`, "type": "text/javascript; charset=utf-8" }, "/style.css": { "body": "*{box-sizing:border-box}body{margin:0;background:#0b1019;color:#e8edf6;font-family:Segoe UI,system-ui,sans-serif;font-size:14px;line-height:1.5}.shell{max-width:1260px;margin:auto;padding:0 32px}header{display:flex;align-items:center;justify-content:space-between;padding:27px 0;border-bottom:1px solid #253041}.brand{display:flex;gap:12px;align-items:center;font-size:13px;letter-spacing:1.5px;font-weight:700}.brand small{display:block;font-size:9px;color:#8b9ab0;font-weight:500;letter-spacing:2px}.mark{background:#abecc8;color:#13271d;border-radius:12px;width:38px;height:38px;display:grid;place-items:center;font-size:22px}.pill{border:1px solid #364453;border-radius:99px;padding:5px 13px;color:#abecc8;font-size:12px}.intro{display:flex;align-items:center;justify-content:space-between;gap:30px;padding:52px 0 30px}.eyebrow{font-size:10px;letter-spacing:2.2px;color:#abecc8;font-weight:700}h1{font-size:clamp(32px,5vw,48px);line-height:1.15;letter-spacing:-1.6px;margin:14px 0 20px;font-weight:650}.muted{color:#92a1b6;font-size:12px}.intro .muted{max-width:460px;font-size:14px}.account{display:flex;flex-direction:column;gap:8px;min-width:260px;border-left:2px solid #abecc8;padding:8px 20px}.account>span:first-child{font-size:9px;letter-spacing:1.2px}.account strong{font-size:19px}.account #account-id{font-size:11px}.stats{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin:24px 0}.stats>div{background:#131c29;border:1px solid #253041;padding:22px;border-radius:12px}.stats span{display:block;color:#9aa8ba;font-size:10px;letter-spacing:1.3px}.stats strong{display:block;font-size:34px;font-weight:600;margin:6px 0}.stats small{color:#8293a9;font-size:11px}.stats>div:nth-child(2) strong{color:#abecc8}.stats>div:nth-child(4) strong{color:#f6b3a0}.panel{background:#111a27;border:1px solid #253041;border-radius:13px;padding:22px;margin:20px 0}.section-title{display:flex;justify-content:space-between;align-items:center;gap:16px;margin-bottom:18px}.section-title h2{margin:0;font-size:17px;font-weight:600}.section-title p{margin:6px 0 0}.filters,.actions,.checks{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:16px 0}.filters input{flex:1;min-width:160px}.filters select{min-width:165px}input,select,button{font:inherit;border:1px solid #344153;border-radius:7px;color:#d9e4f4;background:#0d1520;padding:9px 12px}input:focus,select:focus,button:focus{outline:2px solid #abecc8;outline-offset:2px}button{cursor:pointer;background:#202e40;font-size:12px;font-weight:600}button:hover{background:#2b3e55}button.primary{color:#11251c;background:#abecc8;border-color:#abecc8}button:disabled{opacity:.5;cursor:wait}input[type=checkbox]{accent-color:#abecc8;padding:0}.short{width:75px}.fields{display:grid;grid-template-columns:1fr 1fr;gap:15px;margin:12px 0}.fields label{display:flex;flex-direction:column;gap:6px;color:#a6b4c7;font-size:12px}.checks label,.actions label{font-size:12px;display:flex;gap:6px;align-items:center}.table-wrap{overflow-x:auto}table{width:100%;border-collapse:collapse;font-size:12px}th{text-align:left;padding:14px 10px;color:#8397b0;font-size:9px;font-weight:600;letter-spacing:1.1px;border-bottom:1px solid #2c394b;white-space:nowrap}td{padding:15px 10px;border-bottom:1px solid #202d3e;vertical-align:top}td small{display:block;color:#8495aa;font-size:10px;margin-top:4px;word-break:break-word}.badge{display:inline-block;font-size:10px;border-radius:5px;padding:4px 7px;background:#273447;color:#c1ccdc;white-space:nowrap}.badge.success{background:#183a2b;color:#abecc8}.badge.failed{background:#452c29;color:#f6b3a0}.badge.pending{background:#3d3524;color:#ead3a0}.notice{font-size:11px;color:#8798af;margin:16px 0 0;line-height:1.6}.empty{text-align:center;color:#8397b0;padding:32px}.error{background:#452c29;border:1px solid #985a4a;padding:16px;border-radius:9px;margin:16px 0;overflow-wrap:anywhere}.message{padding:16px 0;border-bottom:1px solid #253041}.message small{color:#92a1b6;font-size:11px}.message p{white-space:pre-wrap;overflow-wrap:anywhere;margin:9px 0}.message strong{font-size:12px}.message span{margin-left:10px}#message-search{width:100%}pre{font-size:11px;max-height:220px;overflow:auto;white-space:pre-wrap;color:#a2b7ce}footer{display:flex;justify-content:space-between;gap:15px;padding:12px 0 30px;font-size:10px;color:#8192a8}summary{cursor:pointer;color:#abecc8;font-size:12px}[hidden]{display:none!important}@media(max-width:760px){.shell{padding:0 16px}.intro{display:block;padding-top:30px}.account{margin-top:28px}.stats{grid-template-columns:repeat(2,1fr)}.fields{grid-template-columns:1fr}.section-title{align-items:flex-start}.panel{padding:16px}.stats>div{padding:15px}header .pill{font-size:10px}h1{font-size:36px}}\n", "type": "text/css; charset=utf-8" } };

// worker.js
var headers = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "X-Frame-Options": "DENY",
  "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"
};
function json(value, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { ...headers, "Content-Type": "application/json" } });
}
__name(json, "json");
async function equals(a, b) {
  const encoder = new TextEncoder();
  const [x, y] = await Promise.all([a, b].map((value) => crypto.subtle.digest("SHA-256", encoder.encode(value))));
  const left = new Uint8Array(x), right = new Uint8Array(y);
  let difference = 0;
  for (let i = 0; i < left.length; i++) difference |= left[i] ^ right[i];
  return difference === 0;
}
__name(equals, "equals");
async function authenticated(request, env) {
  const authorization = request.headers.get("Authorization") || "";
  if (!authorization.startsWith("Basic ")) return false;
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(atob(authorization.slice(6)), (character) => character.charCodeAt(0)));
    const colon = text.indexOf(":");
    if (colon < 0) return false;
    return await equals(text.slice(0, colon), env.DASHBOARD_EMAIL) && await equals(text.slice(colon + 1), env.DASHBOARD_PASSWORD);
  } catch {
    return false;
  }
}
__name(authenticated, "authenticated");
function validSnapshot(value) {
  if (!value || typeof value !== "object" || !value.account || !/^\d+$/.test(value.account.id)) return false;
  if (typeof value.created_at !== "string" || !Number.isFinite(Date.parse(value.created_at))) return false;
  if (!Array.isArray(value.channels) || value.channels.length > 1e4 || !Array.isArray(value.recent_messages) || value.recent_messages.length > 200) return false;
  for (const channel of value.channels) {
    if (!channel || !/^\d+$/.test(channel.id) || typeof channel.channel !== "string" || typeof channel.status !== "string") return false;
    if (channel.last_checked_at != null && !Number.isFinite(Date.parse(channel.last_checked_at))) return false;
  }
  return value.recent_messages.every((message) => message && /^\d+$/.test(message.id) && /^\d+$/.test(message.channel_id) && typeof message.content === "string" && message.content.length <= 8e3);
}
__name(validSnapshot, "validSnapshot");
async function upload(request, env) {
  const authorized = await equals(request.headers.get("Authorization") || "", "Bearer " + env.UPLOAD_TOKEN);
  if (!authorized) return json({ error: "Unauthorized" }, 401);
  if (Number(request.headers.get("Content-Length")) > 2e6) return json({ error: "Snapshot exceeds 2 MB" }, 413);
  if (!(request.headers.get("Content-Type") || "").startsWith("application/json")) return json({ error: "JSON required" }, 415);
  const reader = request.body?.getReader();
  if (!reader) return json({ error: "Empty upload" }, 400);
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > 2e6) {
      await reader.cancel();
      return json({ error: "Snapshot exceeds 2 MB" }, 413);
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  let snapshot;
  try {
    snapshot = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }
  if (!validSnapshot(snapshot)) return json({ error: "Invalid snapshot" }, 400);
  const clean = {
    created_at: snapshot.created_at,
    uploaded_at: (/* @__PURE__ */ new Date()).toISOString(),
    account: { id: snapshot.account.id, username: String(snapshot.account.username || "Unknown"), global_name: snapshot.account.global_name || null },
    channels: snapshot.channels.map((channel) => Object.fromEntries([
      "id",
      "guild_id",
      "guild",
      "channel",
      "status",
      "error",
      "last_started_at",
      "last_checked_at",
      "last_success_at",
      "messages",
      "attachments",
      "downloaded",
      "attachment_errors",
      "checked",
      "history_complete"
    ].map((key) => [key, channel[key] ?? null]))),
    recent_messages: snapshot.recent_messages.map((message) => ({
      id: message.id,
      channel_id: message.channel_id,
      author: String(message.author || "Unknown"),
      timestamp: message.timestamp || null,
      content: message.content
    })),
    message_scope: "Most recent 200 archived messages; full history and attachments remain on the Windows PC."
  };
  await env.BACKUP_KV.put("latest", JSON.stringify(clean));
  return json({ ok: true, uploaded_at: clean.uploaded_at });
}
__name(upload, "upload");
var worker_default = {
  async fetch(request, env) {
    const storage = env.BACKUP_KV || env.EXPORTS;
    const exportStorage = env.EXPORTS || env.BACKUP_KV;
    if (!storage || !env.DASHBOARD_EMAIL || !env.DASHBOARD_PASSWORD || env.DASHBOARD_PASSWORD.length < 16 || !env.UPLOAD_TOKEN || env.UPLOAD_TOKEN.length < 32) {
      return json({ error: "Dashboard setup incomplete. Set storage, dashboard password (16+ characters), and upload token (32+ characters)." }, 503);
    }
    const url = new URL(request.url);
    try {
      if (url.pathname === "/api/upload-status" && request.method === "GET") {
        const allowed = await equals(request.headers.get("Authorization") || "", "Bearer " + env.UPLOAD_TOKEN);
        if (!allowed) return json({ error: "Unauthorized" }, 401);
        return json({ ready: true, format: "DiscordChatExporter", version: 1, maxBytes: 8e6 });
      }
      if (url.pathname === "/api/sync" && request.method === "POST") return await upload(request, { ...env, BACKUP_KV: storage });
      if ((url.pathname === "/" || url.pathname === "/api/exports") && request.method === "POST") {
        const bearer = await equals(request.headers.get("Authorization") || "", "Bearer " + env.UPLOAD_TOKEN);
        if (!bearer && !await authenticated(request, env)) return json({ error: "Unauthorized upload" }, 401);
        return await receiveExport(request, exportStorage);
      }
      if (!await authenticated(request, env)) {
        return new Response("Private backup dashboard. Sign in using your dashboard email and separate dashboard password.", {
          status: 401,
          headers: { ...headers, "WWW-Authenticate": 'Basic realm="Private Discord backup", charset="UTF-8"' }
        });
      }
      if (request.method !== "GET") return json({ error: "Method not allowed" }, 405);
      if (url.pathname === "/api/exports") return await listExports(request, exportStorage);
      if (url.pathname.startsWith("/api/exports/")) return await downloadExport(url.pathname.slice("/api/exports/".length), exportStorage);
      if (url.pathname === "/api/mode") return json({ local: false });
      if (url.pathname === "/api/state") return json({ busy: false, logs: [], status: "Private cloud dashboard" });
      if (url.pathname === "/api/report") {
        const report = await storage.get("latest");
        return report ? new Response(report, { headers: { ...headers, "Content-Type": "application/json" } }) : json({ channels: [], recent_messages: [], account: null });
      }
      if (url.pathname.startsWith("/api/")) return json({ error: "Not found" }, 404);
      const embedded = inlineAssets[url.pathname];
      const response = env.ASSETS ? await env.ASSETS.fetch(request) : embedded ? new Response(embedded.body, { headers: { "Content-Type": embedded.type } }) : new Response("Not found", { status: 404 });
      const protectedResponse = new Response(response.body, response);
      for (const [key, value] of Object.entries(headers)) protectedResponse.headers.set(key, value);
      return protectedResponse;
    } catch {
      return json({ error: "Storage or request failed; retry later" }, 503);
    }
  }
};
export {
  worker_default as default,
  validSnapshot
};
//# sourceMappingURL=worker.js.map
