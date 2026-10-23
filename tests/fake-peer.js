// Test-only stand-in for PeerJS (window.Peer). Real WebRTC needs the PeerJS cloud broker plus UDP/TURN, which CI machines
// cannot rely on, so the game's own multiplayer code runs unchanged and only the data channel is relayed by the test runner.
const PAGE_SHIM = `(function(){
  function Em(){ this._h = {}; }
  Em.prototype.on = function(e, f){ (this._h[e] = this._h[e] || []).push(f); return this; };
  Em.prototype._emit = function(e, a){ (this._h[e] || []).slice().forEach(function(f){ try { f(a); } catch(err) { console.error('shim handler', err && err.message); } }); };
  var conns = {}, peers = {};
  function Conn(peer, remote, cid, md){ Em.call(this); this.peer = remote; this.cid = cid; this.metadata = md; this.open = false; this._p = peer; }
  Conn.prototype = Object.create(Em.prototype);
  Conn.prototype.send = function(d){ if (this.open) window.__fakeNet({t:'data', cid:this.cid, from:this._p.id, data:JSON.parse(JSON.stringify(d))}); };
  Conn.prototype.close = function(){ if (this._closed) return; this._closed = true; this.open = false; window.__fakeNet({t:'close', cid:this.cid, from:this._p.id}); this._emit('close'); };
  function Peer(id){ Em.call(this); this.id = id; this.open = false; this.destroyed = false; peers[id] = this; window.__fakeNet({t:'reg', id:id}); }
  Peer.prototype = Object.create(Em.prototype);
  Peer.prototype.connect = function(to, o){ var cid = Math.random().toString(36).slice(2); var c = new Conn(this, to, cid, o && o.metadata); conns[cid] = c; window.__fakeNet({t:'conn', from:this.id, to:to, cid:cid, metadata:o && o.metadata}); return c; };
  Peer.prototype.reconnect = function(){ window.__fakeNet({t:'reg', id:this.id}); };
  Peer.prototype.destroy = function(){ if (this.destroyed) return; this.destroyed = true; this.open = false; var me = this; Object.keys(conns).forEach(function(k){ if (conns[k]._p === me) conns[k].close(); }); window.__fakeNet({t:'destroy', id:this.id}); };
  window.__fakeRecv = function(m){
    var p = peers[m.id], c = conns[m.cid];
    if (m.t === 'open') { if (p && !p.destroyed) { p.open = true; p._emit('open', p.id); } }
    else if (m.t === 'error') { if (p && !p.destroyed) p._emit('error', {type:m.type}); }
    else if (m.t === 'incoming') { if (!p || p.destroyed) return; c = new Conn(p, m.from, m.cid, m.metadata); conns[m.cid] = c; p._emit('connection', c); }
    else if (m.t === 'copen') { if (c && !c._closed) { c.open = true; c._emit('open'); } }
    else if (m.t === 'data') { if (c && c.open) c._emit('data', m.data); }
    else if (m.t === 'cclose') { if (c && !c._closed) { c._closed = true; c.open = false; c._emit('close'); } }
  };
  window.Peer = Peer; window.__fakePeer = true;
})();`;
async function install(contexts){
  const reg = new Map(), cmap = new Map();
  const deliver = (page, m) => setTimeout(() => page.evaluate(x => window.__fakeRecv && window.__fakeRecv(x), m).catch(() => {}), 25);
  const handler = (page, m) => {
    if (m.t === 'reg') { if (reg.has(m.id) && reg.get(m.id) !== page) deliver(page, {t:'error', id:m.id, type:'unavailable-id'}); else { reg.set(m.id, page); deliver(page, {t:'open', id:m.id}); } }
    else if (m.t === 'conn') {
      const target = reg.get(m.to);
      if (!target) return deliver(page, {t:'error', id:m.from, type:'peer-unavailable'});
      cmap.set(m.cid, {a:{id:m.from, page}, b:{id:m.to, page:target}});
      deliver(target, {t:'incoming', id:m.to, from:m.from, cid:m.cid, metadata:m.metadata});
      setTimeout(() => { if (cmap.has(m.cid)) { deliver(page, {t:'copen', cid:m.cid}); deliver(target, {t:'copen', cid:m.cid}); } }, 80);
    }
    else if (m.t === 'data' || m.t === 'close') {
      const e = cmap.get(m.cid); if (!e) return;
      const other = e.a.id === m.from ? e.b : e.a;
      deliver(other.page, m.t === 'data' ? {t:'data', cid:m.cid, data:m.data} : {t:'cclose', cid:m.cid});
      if (m.t === 'close') cmap.delete(m.cid);
    }
    else if (m.t === 'destroy') {
      if (reg.get(m.id) === page) reg.delete(m.id);
      for (const [cid, e] of cmap) if (e.a.id === m.id || e.b.id === m.id) { const other = e.a.id === m.id ? e.b : e.a; deliver(other.page, {t:'cclose', cid}); cmap.delete(cid); }
    }
  };
  for (const ctx of contexts) { await ctx.exposeBinding('__fakeNet', (src, m) => { handler(src.page, m); }); await ctx.addInitScript(PAGE_SHIM); }
}
module.exports = { install };
