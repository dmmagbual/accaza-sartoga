/* =====================================================================
   AKALIKO PNG — Inventory catalog (brand-immersive)
   Firestore-backed. Admin: Add / edit-in-modal / Delete / Logout.
   Card: image fills frame, shows Brand · Name · PN · Type.
   Detail modal: read-only + Close for visitors; editable for admin.
   ===================================================================== */
(function () {
  "use strict";

  var cfg = window.AKALIKO || {};
  var ADMIN_PIN = cfg.ADMIN_PIN || "akaliko2024";
  var INV_COLLECTION = cfg.INVENTORY_COLLECTION || "inventory";

  var isAdmin = false;
  var editingId = null;
  var activeBrand = null;
  var activeLoc = "";   /* "" = all locations, else "POM" / "LAE" */
  var currentItemId = null;
  var _db = null;
  var _cachedInventory = null;
  var _lastUpdated = "";   /* admin-set "last updated" date, stored in Firestore meta/inventory */
  var themeMode = localStorage.getItem("akaliko_inv_mode") || "immersive";

  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

  /* ---- Seed data (auto-loaded once if Firestore empty) ---- */
  var defaultInventory = [
    { id: uid(), partNo:"335-6352", brand:"CAT", model:"777G", desc:"Front Susp Cylinder", category:"Hydraulic Cylinder", mtype:"Off-Highway Truck", oempn:"335-6352", akpn:"", hs:"841221", weight:"", stroke:"", pin2pin:"", ctype:"Front Suspension", type:"Remanufactured", qty:6, loc:"POM", imgUrl:"", notes:"" },
    { id: uid(), partNo:"335-6354", brand:"CAT", model:"777G", desc:"Rear Suspension", category:"Hydraulic Cylinder", mtype:"Off-Highway Truck", oempn:"335-6354", akpn:"", hs:"841221", weight:"", stroke:"", pin2pin:"", ctype:"Rear Suspension", type:"Remanufactured", qty:6, loc:"POM", imgUrl:"", notes:"" },
    { id: uid(), partNo:"232-0653", brand:"CAT", model:"D10T", desc:"Blade Tilt Cylinder", category:"Hydraulic Cylinder", mtype:"Track Dozer", oempn:"232-0653", akpn:"", hs:"841221", weight:"", stroke:"", pin2pin:"", ctype:"Blade", type:"Remanufactured", qty:2, loc:"POM", imgUrl:"", notes:"" },
    { id: uid(), partNo:"257-5083", brand:"CAT", model:"16M/16H", desc:"Side Shift Cylinder", category:"Hydraulic Cylinder", mtype:"Motor Grader", oempn:"257-5083", akpn:"", hs:"841221", weight:"", stroke:"", pin2pin:"", ctype:"Other", type:"Remanufactured", qty:2, loc:"POM", imgUrl:"", notes:"" },
    { id: uid(), partNo:"261-4949", brand:"CAT", model:"980G", desc:"Steering Cylinder", category:"Hydraulic Cylinder", mtype:"Wheel Loader", oempn:"261-4949", akpn:"", hs:"841221", weight:"", stroke:"", pin2pin:"", ctype:"Other", type:"Remanufactured", qty:3, loc:"POM", imgUrl:"", notes:"" },
    { id: uid(), partNo:"171-1232", brand:"CAT", model:"777D", desc:"Hoist Cylinder", category:"Hydraulic Cylinder", mtype:"Off-Highway Truck", oempn:"171-1232", akpn:"", hs:"841221", weight:"", stroke:"", pin2pin:"", ctype:"Hoist", type:"Remanufactured", qty:6, loc:"POM", imgUrl:"", notes:"" },
    { id: uid(), partNo:"347-7423", brand:"CAT", model:"789C", desc:"Front Suspension", category:"Hydraulic Cylinder", mtype:"Off-Highway Truck", oempn:"347-7423", akpn:"", hs:"841221", weight:"", stroke:"", pin2pin:"", ctype:"Front Suspension", type:"Remanufactured", qty:1, loc:"POM", imgUrl:"", notes:"" },
    { id: uid(), partNo:"438-6225", brand:"CAT", model:"789C", desc:"Hoist Cylinder", category:"Hydraulic Cylinder", mtype:"Off-Highway Truck", oempn:"438-6225", akpn:"", hs:"841221", weight:"", stroke:"", pin2pin:"", ctype:"Hoist", type:"Remanufactured", qty:1, loc:"POM", imgUrl:"", notes:"" },
    { id: uid(), partNo:"439-7439", brand:"CAT", model:"789C", desc:"Rear Suspension", category:"Hydraulic Cylinder", mtype:"Off-Highway Truck", oempn:"439-7439", akpn:"", hs:"841221", weight:"", stroke:"", pin2pin:"", ctype:"Rear Suspension", type:"Remanufactured", qty:1, loc:"POM", imgUrl:"", notes:"" },
    { id: uid(), partNo:"464-9559", brand:"CAT", model:"6030", desc:"Bucket Cylinder", category:"Hydraulic Cylinder", mtype:"Excavator", oempn:"464-9559", akpn:"", hs:"841221", weight:"", stroke:"", pin2pin:"", ctype:"Bucket", type:"Remanufactured", qty:2, loc:"POM", imgUrl:"", notes:"" },
    { id: uid(), partNo:"464-0779", brand:"CAT", model:"6030", desc:"Boom Cylinder BH", category:"Hydraulic Cylinder", mtype:"Excavator", oempn:"464-0779", akpn:"", hs:"841221", weight:"", stroke:"", pin2pin:"", ctype:"Boom", type:"Remanufactured", qty:3, loc:"POM", imgUrl:"", notes:"" },
    { id: uid(), partNo:"465-6194", brand:"CAT", model:"6030", desc:"Stick Cylinder", category:"Hydraulic Cylinder", mtype:"Excavator", oempn:"465-6194", akpn:"", hs:"841221", weight:"", stroke:"", pin2pin:"", ctype:"Stick", type:"Remanufactured", qty:1, loc:"POM", imgUrl:"", notes:"" },
    { id: uid(), partNo:"303-4001", brand:"CAT", model:"R2900G", desc:"Lift Cylinder", category:"Hydraulic Cylinder", mtype:"Underground Loader", oempn:"303-4001", akpn:"", hs:"841221", weight:"", stroke:"", pin2pin:"", ctype:"Other", type:"Remanufactured", qty:1, loc:"POM", imgUrl:"", notes:"" },
    { id: uid(), partNo:"468-2480", brand:"HIT", model:"EX1200-6", desc:"Boom Cylinder", category:"Hydraulic Cylinder", mtype:"Excavator", oempn:"468-2480", akpn:"", hs:"841221", weight:"", stroke:"", pin2pin:"", ctype:"Boom", type:"Remanufactured", qty:1, loc:"POM", imgUrl:"", notes:"" },
    { id: uid(), partNo:"707-01-0K750", brand:"KOM", model:"PC2000-8", desc:"Boom Cylinder LH", category:"Hydraulic Cylinder", mtype:"Excavator", oempn:"707-01-0K750", akpn:"", hs:"841221", weight:"", stroke:"", pin2pin:"", ctype:"Boom", type:"Remanufactured", qty:1, loc:"POM", imgUrl:"", notes:"" },
    { id: uid(), partNo:"707-01-0K790", brand:"KOM", model:"PC2000", desc:"Bucket Cylinder LH/RH", category:"Hydraulic Cylinder", mtype:"Excavator", oempn:"707-01-0K790", akpn:"", hs:"841221", weight:"", stroke:"", pin2pin:"", ctype:"Bucket", type:"Remanufactured", qty:1, loc:"POM", imgUrl:"", notes:"" },
    { id: uid(), partNo:"561-50-82003", brand:"KOM", model:"HD785-7", desc:"Rear Suspension", category:"Hydraulic Cylinder", mtype:"Off-Highway Truck", oempn:"561-50-82003", akpn:"", hs:"841221", weight:"", stroke:"", pin2pin:"", ctype:"Rear Suspension", type:"Remanufactured", qty:6, loc:"POM", imgUrl:"", notes:"" },
    { id: uid(), partNo:"707-00-0G703", brand:"KOM", model:"HD785-7", desc:"Steering Cylinder RH/LH", category:"Hydraulic Cylinder", mtype:"Off-Highway Truck", oempn:"707-00-0G703", akpn:"", hs:"841221", weight:"", stroke:"", pin2pin:"", ctype:"Other", type:"Remanufactured", qty:4, loc:"POM", imgUrl:"", notes:"" },
    { id: uid(), partNo:"503-9754", brand:"CAT", model:"6050FS", desc:"Clam Cylinder", category:"Hydraulic Cylinder", mtype:"Shovel", oempn:"503-9754", akpn:"", hs:"841221", weight:"", stroke:"", pin2pin:"", ctype:"Other", type:"Remanufactured", qty:4, loc:"POM", imgUrl:"", notes:"" },
    { id: uid(), partNo:"428-8692", brand:"CAT", model:"745C", desc:"Hoist Cylinder", category:"Hydraulic Cylinder", mtype:"Dump Truck", oempn:"428-8692", akpn:"", hs:"841221", weight:"", stroke:"", pin2pin:"", ctype:"Hoist", type:"Remanufactured", qty:3, loc:"POM", imgUrl:"", notes:"" },
    { id: uid(), partNo:"116-3092", brand:"CAT", model:"773B", desc:"Front Suspension", category:"Hydraulic Cylinder", mtype:"Off-Highway Truck", oempn:"116-3092", akpn:"", hs:"841221", weight:"", stroke:"", pin2pin:"", ctype:"Front Suspension", type:"Remanufactured", qty:1, loc:"POM", imgUrl:"", notes:"" },
    { id: uid(), partNo:"471-2134", brand:"CAT", model:"6050FS", desc:"Boom Cylinder", category:"Hydraulic Cylinder", mtype:"Excavator", oempn:"471-2134", akpn:"", hs:"841221", weight:"", stroke:"", pin2pin:"", ctype:"Boom", type:"Remanufactured", qty:1, loc:"POM", imgUrl:"", notes:"" },
    { id: uid(), partNo:"295-5706", brand:"CAT", model:"793D/793F", desc:"Front Suspension", category:"Hydraulic Cylinder", mtype:"Off-Highway Truck", oempn:"295-5706", akpn:"", hs:"841221", weight:"", stroke:"", pin2pin:"", ctype:"Front Suspension", type:"Remanufactured", qty:6, loc:"POM", imgUrl:"", notes:"" },
    { id: uid(), partNo:"467-1658", brand:"CAT", model:"6050FS", desc:"Stick / Bucket", category:"Hydraulic Cylinder", mtype:"Excavator", oempn:"467-1658", akpn:"", hs:"841221", weight:"", stroke:"", pin2pin:"", ctype:"Bucket", type:"Remanufactured", qty:2, loc:"POM", imgUrl:"", notes:"" },
    { id: uid(), partNo:"341-4124", brand:"CAT", model:"740B", desc:"Front Suspension", category:"Hydraulic Cylinder", mtype:"Off-Highway Truck", oempn:"341-4124", akpn:"", hs:"841221", weight:"", stroke:"", pin2pin:"", ctype:"Front Suspension", type:"Exchange", qty:3, loc:"POM", imgUrl:"", notes:"" },
    { id: uid(), partNo:"707-09-00080", brand:"KOM", model:"HM400-2", desc:"Hoist Cylinder", category:"Hydraulic Cylinder", mtype:"Articulated Dump Truck", oempn:"707-09-00080", akpn:"", hs:"841221", weight:"", stroke:"", pin2pin:"", ctype:"Hoist", type:"Remanufactured", qty:2, loc:"POM", imgUrl:"", notes:"" }
  ];

  /* ---- Firebase helpers ---- */
  async function getDB() {
    if (_db) return _db;
    var fcfg = (window.AKALIKO || {}).firebaseConfig || {};
    var appMod = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js");
    var fsMod  = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js");
    var app = appMod.initializeApp(fcfg, "akaliko-inv");
    _db = fsMod.getFirestore(app);
    return _db;
  }
  async function loadInventory() {
    try {
      var db = await getDB();
      var fsMod = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js");
      var snap = await fsMod.getDocs(fsMod.collection(db, INV_COLLECTION));
      if (snap.empty) {
        for (var item of defaultInventory) { await fsMod.setDoc(fsMod.doc(db, INV_COLLECTION, item.id), item); }
        _cachedInventory = defaultInventory.slice();
      } else {
        _cachedInventory = snap.docs.map(function (d) { return d.data(); });
      }
    } catch (e) {
      console.warn("Firestore error, using defaults:", e);
      if (!_cachedInventory) _cachedInventory = defaultInventory.slice();
    }
    return _cachedInventory;
  }
  async function saveItem_fs(item) {
    try {
      var db = await getDB();
      var fsMod = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js");
      await fsMod.setDoc(fsMod.doc(db, INV_COLLECTION, item.id), item);
    } catch (e) { console.warn("saveItem_fs error:", e); }
    if (_cachedInventory) {
      var idx = _cachedInventory.findIndex(function (x) { return x.id === item.id; });
      if (idx > -1) _cachedInventory[idx] = item; else _cachedInventory.push(item);
    }
  }
  async function deleteItem_fs(id) {
    try {
      var db = await getDB();
      var fsMod = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js");
      await fsMod.deleteDoc(fsMod.doc(db, INV_COLLECTION, id));
    } catch (e) { console.warn("deleteItem_fs error:", e); }
    if (_cachedInventory) _cachedInventory = _cachedInventory.filter(function (x) { return x.id !== id; });
  }

  /* ---- Helpers ---- */
  function brandLabel(b) { return { CAT:"Caterpillar", KOM:"Komatsu", HIT:"Hitachi", OTH:"Other" }[b] || b; }
  function locLabel(l) { return { POM:"Port Moresby", LAE:"Lae" }[l] || l; }
  function typeOf(r) { return r.ctype && r.ctype !== "Other" ? r.ctype : (r.category || "Cylinder"); }
  function nameOf(r) { return r.desc || typeOf(r); }
  function esc(s) { return String(s || "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"); }

  /* ---- Home view: brand counts ---- */
  async function renderHome() {
    var data = await loadInventory();
    ["CAT","KOM","HIT","OTH"].forEach(function (b) {
      var n = data.filter(function (r) { return r.brand === b; }).length;
      var el = document.getElementById("count-" + b);
      if (el) el.textContent = n + (n === 1 ? " item" : " items");
    });
  }

  /* ---- Brand view: product cards (image fill · Brand · Name · PN · Type) ---- */
  window.renderCards = async function () {
    var data = await loadInventory();
    var q = ((document.getElementById("invSearch") || {}).value || "").toLowerCase();
    var filtered = data.filter(function (r) {
      if (r.brand !== activeBrand) return false;
      if (activeLoc && r.loc !== activeLoc) return false;
      if (!q) return true;
      return (r.partNo||"").toLowerCase().indexOf(q) > -1 ||
             (r.model||"").toLowerCase().indexOf(q) > -1 ||
             (r.desc||"").toLowerCase().indexOf(q) > -1 ||
             (r.ctype||"").toLowerCase().indexOf(q) > -1 ||
             (r.category||"").toLowerCase().indexOf(q) > -1 ||
             (r.oempn||"").toLowerCase().indexOf(q) > -1;
    });
    var cntEl = document.getElementById("invItemCount");
    if (cntEl) cntEl.textContent = filtered.length + " item" + (filtered.length !== 1 ? "s" : "");
    var addBtn = document.getElementById("adminAddBtn");
    if (addBtn) addBtn.style.display = isAdmin ? "" : "none";

    var grid = document.getElementById("invCardGrid");
    if (!grid) return;
    if (filtered.length === 0) {
      grid.innerHTML = '<div class="inv-empty" style="grid-column:1/-1;">No items found for this brand.</div>';
      return;
    }
    grid.innerHTML = filtered.map(function (r) {
      var imgHtml = r.imgUrl
        ? '<img src="' + esc(r.imgUrl) + '" alt="' + esc(brandLabel(r.brand) + " " + nameOf(r)) + '" loading="lazy" onerror="this.parentNode.innerHTML=\'<div class=&quot;inv-prod-img-placeholder&quot;>' + esc(r.brand) + '<br>No image</div>\'">'
        : '<div class="inv-prod-img-placeholder">' + esc(r.brand) + '<br>No image yet</div>';
      return '<div class="inv-prod-card" onclick="openItemDetail(\'' + r.id + '\')">' +
        '<div class="inv-prod-img">' + imgHtml + '</div>' +
        '<div class="inv-prod-body">' +
          '<div class="inv-prod-brand">' + esc(brandLabel(r.brand)) + '</div>' +
          '<div class="inv-prod-name">' + esc(nameOf(r)) + '</div>' +
          '<div class="inv-prod-pn">PN ' + esc(r.partNo || "—") + '</div>' +
          '<div class="inv-prod-pn">Model ' + esc(r.model || "—") + '</div>' +
          '<span class="inv-prod-type">' + esc(typeOf(r)) + '</span>' +
          (isAdmin
            ? '<div class="inv-prod-admin">' +
                '<button class="inv-card-btn edit" onclick="event.stopPropagation();openEditModal(\'' + r.id + '\')">Edit</button>' +
                '<button class="inv-card-btn del" onclick="event.stopPropagation();invDeleteItem(\'' + r.id + '\')">Delete</button>' +
              '</div>'
            : '') +
        '</div>' +
      '</div>';
    }).join("");
  };

  /* Delete straight from a card (admin only) */
  window.invDeleteItem = async function (id) {
    if (!isAdmin) return;
    if (!confirm("Delete this item from inventory?")) return;
    await deleteItem_fs(id);
    renderCards(); renderHome();
  };

  /* ---- Theme mode ---- */
  function applyThemeAttrs() {
    var v = document.getElementById("invBrandView");
    if (!v) return;
    v.setAttribute("data-mode", themeMode);
    if (activeBrand) v.setAttribute("data-brand", activeBrand);
    if (activeBrand && activeBrand !== "OTH") v.classList.add("themed");
    else v.classList.remove("themed");
    document.querySelectorAll("[data-modebtn]").forEach(function (b) {
      b.classList.toggle("on", b.getAttribute("data-modebtn") === themeMode);
    });
  }
  window.invSetMode = function (mode) {
    themeMode = mode;
    localStorage.setItem("akaliko_inv_mode", mode);
    applyThemeAttrs();
  };

  /* ---- Location filter ---- */
  window.invSetLoc = function (loc) {
    activeLoc = loc || "";
    document.querySelectorAll("[data-locbtn]").forEach(function (b) {
      b.classList.toggle("on", b.getAttribute("data-locbtn") === activeLoc);
    });
    if (activeBrand) renderCards();
  };

  /* ---- Navigation ---- */
  window.invSelectBrand = function (brand) {
    activeBrand = brand;
    document.getElementById("invHomeView").style.display = "none";
    document.getElementById("invBrandView").style.display = "block";
    document.getElementById("bc-home").classList.remove("active");
    document.getElementById("bc-sep").style.display = "";
    var bcBrand = document.getElementById("bc-brand");
    bcBrand.textContent = brandLabel(brand);
    bcBrand.style.display = "";
    bcBrand.classList.add("active");
    var bm = document.getElementById("invBrandMark"); if (bm) bm.textContent = brand;
    var bn = document.getElementById("invBrandName"); if (bn) bn.textContent = brandLabel(brand);
    var s = document.getElementById("invSearch"); if (s) s.value = "";
    applyThemeAttrs();
    renderCards();
  };
  window.invGoHome = function () {
    activeBrand = null;
    document.getElementById("invHomeView").style.display = "";
    document.getElementById("invBrandView").style.display = "none";
    document.getElementById("bc-home").classList.add("active");
    document.getElementById("bc-sep").style.display = "none";
    var bcBrand = document.getElementById("bc-brand");
    bcBrand.style.display = "none";
    bcBrand.classList.remove("active");
  };
  window.renderInventory = async function () {
    await renderHome();
    if (activeBrand) renderCards();
    loadLastUpdated();
  };

  /* ---- "Last updated" date — admin-editable, stored in Firestore meta/inventory ---- */
  function fmtDate(v) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(v)) {
      var d = new Date(v + "T00:00:00");
      if (!isNaN(d)) return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
    }
    return v;
  }
  function renderLastUpdated() {
    var el = document.getElementById("invLastUpdated");
    if (!el) return;
    if (isAdmin) {
      el.innerHTML = '<input type="date" id="luInput" value="' + esc(_lastUpdated) + '" style="background:var(--surface);border:1px solid var(--line);color:var(--text);border-radius:4px;font-family:var(--mono);font-size:.72rem;padding:.15rem .4rem;"> ' +
        '<button class="btn--admin" style="padding:.2rem .65rem;" onclick="saveLastUpdated()">Save</button>';
    } else {
      el.textContent = _lastUpdated ? fmtDate(_lastUpdated) : "—";
    }
  }
  async function loadLastUpdated() {
    try {
      var db = await getDB();
      var fsMod = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js");
      var snap = await fsMod.getDoc(fsMod.doc(db, "meta", "inventory"));
      if (snap.exists() && snap.data().lastUpdated) _lastUpdated = snap.data().lastUpdated;
    } catch (e) { console.warn("loadLastUpdated error:", e); }
    renderLastUpdated();
  }
  window.saveLastUpdated = async function () {
    if (!isAdmin) return;
    var inp = document.getElementById("luInput");
    _lastUpdated = inp ? inp.value : _lastUpdated;
    try {
      var db = await getDB();
      var fsMod = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js");
      await fsMod.setDoc(fsMod.doc(db, "meta", "inventory"), { lastUpdated: _lastUpdated }, { merge: true });
    } catch (e) { console.warn("saveLastUpdated error:", e); }
    renderLastUpdated();
  };

  /* ---- Item detail modal ---- */
  var _editMode = false;
  var _pendingImgData = null;

  function compressImage(file, cb) {
    var reader = new FileReader();
    reader.onload = function (e) {
      var img = new Image();
      img.onload = function () {
        var maxW = 800, maxH = 800, w = img.width, h = img.height;
        if (w > maxW) { h = Math.round(h * maxW / w); w = maxW; }
        if (h > maxH) { w = Math.round(w * maxH / h); h = maxH; }
        var canvas = document.createElement("canvas");
        canvas.width = w; canvas.height = h;
        canvas.getContext("2d").drawImage(img, 0, 0, w, h);
        cb(canvas.toDataURL("image/jpeg", 0.78));
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  }
  function setModalImage(src) {
    var inner = document.getElementById("itemModalImgInner");
    if (!inner) return;
    inner.innerHTML = src
      ? '<img src="' + esc(src) + '" alt="product image">'
      : '<span class="item-modal__img-placeholder">No image available</span>';
  }

  /* Build the two tables. ro = read-only (visitor); else editable (admin). */
  function txtCell(field, val, ph) { return '<td><input type="text" id="ef_' + field + '" value="' + esc(val || "") + '" placeholder="' + esc(ph || "") + '"></td>'; }
  function roCell(val) { return '<td>' + (val ? esc(val) : '<span style="color:#9bb0bd;">—</span>') + '</td>'; }

  function buildDetailRows(r, ro) {
    if (ro) {
      return [
        "<tr><td>Description</td>" + roCell(r.desc) + "</tr>",
        "<tr><td>Part No.</td>" + roCell(r.partNo) + "</tr>",
        "<tr><td>Brand</td>" + roCell(brandLabel(r.brand)) + "</tr>",
        "<tr><td>Model</td>" + roCell(r.model) + "</tr>",
        "<tr><td>Type</td>" + roCell(r.type) + "</tr>",
        "<tr><td>Qty</td>" + roCell(String(r.qty != null ? r.qty : "")) + "</tr>",
        "<tr><td>Location</td>" + roCell(locLabel(r.loc)) + "</tr>"
      ].join("");
    }
    var brandOpts = [["CAT","Caterpillar"],["KOM","Komatsu"],["HIT","Hitachi"],["OTH","Other"]].map(function (b) { return '<option value="' + b[0] + '"' + (r.brand === b[0] ? " selected" : "") + ">" + b[1] + "</option>"; }).join("");
    var typeOpts = ["New","Remanufactured","Exchange","Consignment"].map(function (t) { return "<option" + (r.type === t ? " selected" : "") + ">" + t + "</option>"; }).join("");
    var locOpts = [["POM","Port Moresby"],["LAE","Lae"]].map(function (l) { return '<option value="' + l[0] + '"' + (r.loc === l[0] ? " selected" : "") + ">" + l[1] + "</option>"; }).join("");
    return [
      "<tr><td>Description</td>" + txtCell("desc", r.desc, "") + "</tr>",
      "<tr><td>Part No.</td>" + txtCell("partNo", r.partNo, "") + "</tr>",
      '<tr><td>Brand</td><td><select id="ef_brand">' + brandOpts + "</select></td></tr>",
      "<tr><td>Model</td>" + txtCell("model", r.model, "e.g. 777G") + "</tr>",
      '<tr><td>Type</td><td><select id="ef_type">' + typeOpts + "</select></td></tr>",
      '<tr><td>Qty</td><td><input type="number" id="ef_qty" value="' + esc(String(r.qty || 0)) + '" min="0"></td></tr>',
      '<tr><td>Location</td><td><select id="ef_loc">' + locOpts + "</select></td></tr>"
    ].join("");
  }
  function buildSpecRows(r, ro) {
    if (ro) {
      return [
        "<tr><td>Product category</td>" + roCell(r.category) + "</tr>",
        "<tr><td>Machine type</td>" + roCell(r.mtype) + "</tr>",
        "<tr><td>Cylinder type</td>" + roCell(r.ctype) + "</tr>",
        "<tr><td>Weight</td>" + roCell(r.weight) + "</tr>",
        "<tr><td>Maximum working pressure</td>" + roCell(r.mwp) + "</tr>",
        "<tr><td>Stroke length</td>" + roCell(r.stroke) + "</tr>",
        "<tr><td>Pin to pin length</td>" + roCell(r.pin2pin) + "</tr>",
        "<tr><td>Akaliko part number</td>" + roCell(r.akpn) + "</tr>",
        "<tr><td>OEM part number</td>" + roCell(r.oempn) + "</tr>",
        "<tr><td>HS code</td>" + roCell(r.hs) + "</tr>",
        "<tr><td>Notes</td>" + roCell(r.notes) + "</tr>"
      ].join("");
    }
    return [
      "<tr><td>Product category</td>" + txtCell("category", r.category, "e.g. Hydraulic Cylinder") + "</tr>",
      "<tr><td>Machine type</td>" + txtCell("mtype", r.mtype, "e.g. Off-Highway Truck") + "</tr>",
      "<tr><td>Cylinder type</td>" + txtCell("ctype", r.ctype, "e.g. Blade, Hoist, Boom") + "</tr>",
      "<tr><td>Weight</td>" + txtCell("weight", r.weight, "e.g. 695.53kg") + "</tr>",
      "<tr><td>Maximum working pressure</td>" + txtCell("mwp", r.mwp, "e.g. 250.0 bar") + "</tr>",
      "<tr><td>Stroke length</td>" + txtCell("stroke", r.stroke, "e.g. 318.52mm") + "</tr>",
      "<tr><td>Pin to pin length</td>" + txtCell("pin2pin", r.pin2pin, "e.g. 1003.3mm") + "</tr>",
      "<tr><td>Akaliko part number</td>" + txtCell("akpn", r.akpn, "e.g. AKC33563521") + "</tr>",
      "<tr><td>OEM part number</td>" + txtCell("oempn", r.oempn, "e.g. 335-6352") + "</tr>",
      "<tr><td>HS code</td>" + txtCell("hs", r.hs, "e.g. 841221") + "</tr>",
      "<tr><td>Notes</td>" + txtCell("notes", r.notes, "") + "</tr>"
    ].join("");
  }
  function renderModalFooter(ro) {
    var f = document.getElementById("itemModalFooter");
    if (!f) return;
    if (ro) {
      f.innerHTML = '<span style="flex:1"></span><button class="btn btn--ghost" onclick="closeItemModal()">Close</button>';
    } else {
      f.innerHTML =
        '<button class="btn btn--solid" onclick="saveInlineEdit()" style="background:#1a7a3c;border-color:#1a7a3c;">&#10003; Save &amp; Close</button>' +
        '<button class="btn btn--ghost" onclick="closeItemModal()">Close without saving</button>' +
        '<button class="btn--danger" onclick="deleteCurrentItem()" style="margin-left:auto;">Delete</button>';
    }
  }
  window.openItemDetail = function (id) {
    var data = _cachedInventory || defaultInventory;
    var r = data.find(function (x) { return x.id === id; });
    if (!r) return;
    currentItemId = id; _pendingImgData = null;
    var ro = !isAdmin;
    _editMode = !ro;
    setModalImage(r.imgUrl || "");
    var imgArea = document.getElementById("itemModalImgArea");
    if (imgArea) { isAdmin ? imgArea.classList.add("editable") : imgArea.classList.remove("editable"); }
    var rb = document.getElementById("itemReplaceBtn"); if (rb) rb.style.display = isAdmin ? "" : "none";
    document.getElementById("itemDetailTable").innerHTML = buildDetailRows(r, ro);
    document.getElementById("itemSpecTable").innerHTML = buildSpecRows(r, ro);
    renderModalFooter(ro);
    document.getElementById("itemModal").classList.add("open");
  };
  window.closeItemModal = function () {
    document.getElementById("itemModal").classList.remove("open");
    currentItemId = null; _editMode = false; _pendingImgData = null;
  };
  var itemModalEl = document.getElementById("itemModal");
  if (itemModalEl) itemModalEl.addEventListener("click", function (e) { if (e.target === this) closeItemModal(); });

  function getEditVal(id) { var el = document.getElementById(id); return el ? el.value.trim() : ""; }
  window.saveInlineEdit = async function () {
    if (!currentItemId || !isAdmin) { closeItemModal(); return; }
    var data = _cachedInventory || defaultInventory;
    var r = Object.assign({}, data.find(function (x) { return x.id === currentItemId; }));
    if (!r) return;
    r.desc = getEditVal("ef_desc"); r.partNo = getEditVal("ef_partNo"); r.brand = getEditVal("ef_brand");
    r.model = getEditVal("ef_model"); r.type = getEditVal("ef_type"); r.loc = getEditVal("ef_loc");
    r.qty = parseInt(getEditVal("ef_qty"), 10) || 0; r.category = getEditVal("ef_category");
    r.mtype = getEditVal("ef_mtype"); r.ctype = getEditVal("ef_ctype"); r.weight = getEditVal("ef_weight");
    r.mwp = getEditVal("ef_mwp");
    r.stroke = getEditVal("ef_stroke"); r.pin2pin = getEditVal("ef_pin2pin"); r.akpn = getEditVal("ef_akpn");
    r.oempn = getEditVal("ef_oempn"); r.hs = getEditVal("ef_hs"); r.notes = getEditVal("ef_notes");
    if (_pendingImgData) r.imgUrl = _pendingImgData;
    await saveItem_fs(r);
    closeItemModal();
    await renderCards(); await renderHome();
  };

  /* Image upload */
  window.triggerImgUpload = function () { document.getElementById("itemImgFile").click(); };
  function openImageZoom(src) {
    if (!src) return;
    var ov = document.getElementById("imgZoomOverlay");
    if (!ov) {
      ov = document.createElement("div");
      ov.id = "imgZoomOverlay";
      ov.className = "img-zoom-overlay";
      ov.innerHTML = '<img alt="Enlarged product image">';
      ov.addEventListener("click", function () { ov.classList.remove("open"); });
      document.body.appendChild(ov);
    }
    ov.querySelector("img").src = src;
    ov.classList.add("open");
  }
  /* Clicking the image enlarges it (admins upload via the Replace image button). */
  window.imgAreaClick = function () {
    var inner = document.getElementById("itemModalImgInner");
    var img = inner ? inner.querySelector("img") : null;
    if (img && img.getAttribute("src")) openImageZoom(img.getAttribute("src"));
  };
  window.handleImgUpload = function (event) {
    var file = event.target.files[0];
    if (!file) return;
    compressImage(file, function (b64) { _pendingImgData = b64; setModalImage(b64); });
    event.target.value = "";
  };

  window.deleteCurrentItem = async function () {
    if (!currentItemId || !isAdmin) return;
    if (!confirm("Delete this item from inventory?")) return;
    await deleteItem_fs(currentItemId);
    closeItemModal();
    renderCards(); renderHome();
  };

  /* ---- Admin login ---- */
  window.openAdminLogin = function () {
    if (isAdmin) { invLogout(); return; }
    document.getElementById("adminLoginModal").classList.add("open");
    setTimeout(function () { var p = document.getElementById("invPinInput"); if (p) p.focus(); }, 60);
  };
  window.closeAdminLogin = function () { document.getElementById("adminLoginModal").classList.remove("open"); };
  var adminLoginEl = document.getElementById("adminLoginModal");
  if (adminLoginEl) adminLoginEl.addEventListener("click", function (e) { if (e.target === this) closeAdminLogin(); });
  window.invLogin = function () {
    var pin = (document.getElementById("invPinInput") || {}).value || "";
    var msg = document.getElementById("invLoginMsg");
    if (pin === ADMIN_PIN) {
      isAdmin = true;
      closeAdminLogin();
      document.getElementById("adminBar").classList.remove("hidden");
      document.getElementById("adminLoginToggle").textContent = "Admin: logout";
      if (msg) msg.textContent = "";
      var p = document.getElementById("invPinInput"); if (p) p.value = "";
      if (activeBrand) renderCards();
      renderLastUpdated();
    } else if (msg) { msg.textContent = "Incorrect PIN. Try again."; }
  };
  window.invLogout = function () {
    isAdmin = false;
    document.getElementById("adminBar").classList.add("hidden");
    document.getElementById("adminLoginToggle").textContent = "Admin access";
    if (activeBrand) renderCards();
    renderLastUpdated();
  };

  /* ---- Add modal (3 essentials; full detail edited in the item pop-up) ---- */
  window.openAddModal = function () {
    editingId = null;
    document.getElementById("modalTitle").textContent = "Add Item";
    clearModal();
    if (activeBrand) document.getElementById("fBrand").value = activeBrand;
    document.getElementById("invModal").classList.add("open");
  };
  /* Card "Edit" button → the simple form (basics only), pre-filled */
  window.openEditModal = function (id) {
    var data = _cachedInventory || defaultInventory;
    var r = data.find(function (x) { return x.id === id; });
    if (!r || !isAdmin) return;
    editingId = id;
    document.getElementById("modalTitle").textContent = "Edit Item";
    document.getElementById("fPartNo").value = r.partNo || "";
    document.getElementById("fBrand").value = r.brand || "CAT";
    document.getElementById("fDesc").value = r.desc || "";
    var md = document.getElementById("fModel"); if (md) md.value = r.model || "";
    document.getElementById("invModal").classList.add("open");
  };
  window.closeModal = function () { document.getElementById("invModal").classList.remove("open"); editingId = null; };
  var invModalEl = document.getElementById("invModal");
  if (invModalEl) invModalEl.addEventListener("click", function (e) { if (e.target === this) closeModal(); });
  function clearModal() {
    var pn = document.getElementById("fPartNo"); if (pn) pn.value = "";
    var ds = document.getElementById("fDesc"); if (ds) ds.value = "";
    var md = document.getElementById("fModel"); if (md) md.value = "";
    document.getElementById("fBrand").value = "CAT";
  }
  window.saveItem = async function () {
    var existing = editingId ? (_cachedInventory || []).find(function (x) { return x.id === editingId; }) : null;
    var item = existing
      ? Object.assign({}, existing)   /* editing: keep all other specs intact */
      : { id: uid(), category: "", mtype: "", oempn: "", akpn: "", hs: "", weight: "", mwp: "", stroke: "", pin2pin: "", ctype: "", imgUrl: "", type: "New", loc: "POM", qty: 1, notes: "" };
    item.id = editingId || item.id || uid();
    item.partNo = document.getElementById("fPartNo").value.trim();
    item.brand = document.getElementById("fBrand").value;
    item.desc = document.getElementById("fDesc").value.trim();
    item.model = document.getElementById("fModel") ? document.getElementById("fModel").value.trim() : (item.model || "");
    if (!item.partNo && !item.desc) { alert("Add at least a part number or description."); return; }
    closeModal();
    await saveItem_fs(item);
    if (item.brand === activeBrand) renderCards();
    renderHome();
  };

  /* ---- Responsive grids ---- */
  function applyCardBreakpoints() {
    var grid = document.getElementById("invCardGrid");
    if (!grid) return;
    var w = window.innerWidth;
    grid.style.gridTemplateColumns = w < 600 ? "1fr" : w < 920 ? "1fr 1fr" : "repeat(3,1fr)";
  }
  function applyBrandBreakpoints() {
    var grid = document.querySelector(".inv-brand-grid");
    if (!grid) return;
    grid.style.gridTemplateColumns = window.innerWidth < 600 ? "1fr 1fr" : window.innerWidth < 920 ? "repeat(2,1fr)" : "repeat(4,1fr)";
  }
  window.addEventListener("resize", function () { applyCardBreakpoints(); applyBrandBreakpoints(); });

  /* ---- Init ---- */
  if (document.getElementById("invHomeView")) {
    applyThemeAttrs();
    applyCardBreakpoints();
    applyBrandBreakpoints();
    renderInventory();
    /* discreet admin entry: open login when URL hash is #admin */
    function checkAdminHash() {
      if ((window.location.hash || "").toLowerCase() === "#admin" && !isAdmin) window.openAdminLogin();
    }
    checkAdminHash();
    window.addEventListener("hashchange", checkAdminHash);
  }
})();
