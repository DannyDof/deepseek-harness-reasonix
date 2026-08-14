(function () {
  "use strict";

  var log = document.getElementById("log");
  var input = document.getElementById("input");
  var sendBtn = document.getElementById("send");
  var costEl = document.getElementById("cost");
  var cacheEl = document.getElementById("cache");
  var sessionId = null;

  function append(kind, text) {
    var wrap = document.createElement("div");
    wrap.className = "msg " + kind;
    var bubble = document.createElement("div");
    bubble.className = "bubble";
    bubble.textContent = text;
    wrap.appendChild(bubble);
    log.appendChild(wrap);
    log.scrollTop = log.scrollHeight;
  }

  function appendMeta(text) {
    var p = document.createElement("div");
    p.className = "meta-line";
    p.textContent = text;
    log.appendChild(p);
    log.scrollTop = log.scrollHeight;
  }

  function setCost(level) {
    costEl.className = "badge " + level;
    costEl.textContent = "成本 · " + (level === "green" ? "绿" : level === "amber" ? "黄" : "红");
  }

  function rpc(method, params) {
    return fetch("/rpc", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method: method, params: params || {} }),
    }).then(function (r) { return r.json(); });
  }

  function renderEvents(events) {
    var assistantText = "";
    events.forEach(function (ev) {
      if (ev.type === "assistant_chunk") assistantText += ev.delta;
      else if (ev.type === "assistant_message") {
        if (!assistantText) assistantText = ev.content;
        append("assistant", assistantText);
        assistantText = "";
      } else if (ev.type === "cost_updated") {
        appendMeta("成本 " + ev.turnCostUsd.toFixed(4) + " 美元（" + ev.tier + "）· 分级 " + ev.level);
        setCost(ev.level);
      }
    });
    if (assistantText) append("assistant", assistantText);
  }

  function send() {
    var text = input.value.trim();
    if (!text) return;
    append("user", text);
    input.value = "";

    var ensure = sessionId ? Promise.resolve({ result: { sessionId: sessionId } })
      : rpc("session/new", {}).then(function (r) { sessionId = r.result.sessionId; return r; });

    ensure.then(function () {
      return rpc("session/prompt", { sessionId: sessionId, prompt: text });
    }).then(function (r) {
      if (r.error) { appendMeta("错误: " + r.error.message); return; }
      renderEvents(r.result.events);
      cacheEl.textContent = "前缀 · " + (r.result.prefixStable ? "稳定" : "漂移");
    }).catch(function (e) {
      appendMeta("请求失败: " + e.message);
    });
  }

  sendBtn.addEventListener("click", send);
  input.addEventListener("keydown", function (e) { if (e.key === "Enter") send(); });

  rpc("initialize", {}).then(function (r) {
    if (r.result) appendMeta("已连接 " + r.result.agentVersion);
  });
})();
