/* =====================================================================
   AKALIKO PNG — shared site behaviour
   nav, mobile menu, scroll reveal, stat counters, quote form,
   before/after slider, WhatsApp links, footer year
   ===================================================================== */
(function () {
  "use strict";
  document.documentElement.classList.add("js");

  var cfg = window.AKALIKO || {};
  var INQUIRY_COLLECTION = cfg.INQUIRY_COLLECTION || "inquiries";
  var FALLBACK_EMAIL = cfg.FALLBACK_EMAIL || "admin.png@akaliko.global";
  var firebaseConfig = cfg.firebaseConfig || {};
  var firebaseReady = !String(firebaseConfig.projectId || "REPLACE_").startsWith("REPLACE_");

  /* ---- Footer year ---- */
  var y = document.getElementById("year");
  if (y) y.textContent = new Date().getFullYear();

  /* ---- WhatsApp links ---- */
  if (cfg.WHATSAPP) {
    var waHref = "https://wa.me/" + cfg.WHATSAPP +
      "?text=" + encodeURIComponent("Hi Akaliko PNG, I'd like to ask about ");
    document.querySelectorAll("[data-wa]").forEach(function (a) { a.href = waHref; });
  }

  /* ---- Client marquee: duplicate the track once for a seamless loop ---- */
  var clientTrack = document.getElementById("clientTrack");
  if (clientTrack) {
    var clone = clientTrack.innerHTML;
    clientTrack.insertAdjacentHTML("beforeend", clone);
  }

  /* ---- Gallery tabs + lightbox ---- */
  window.galShow = function (cat) {
    ["team", "workshop", "warehouse", "events"].forEach(function (c) {
      var g = document.getElementById("gal-" + c);
      if (g) { if (c === cat) { g.style.display = "grid"; g.classList.add("in"); } else { g.style.display = "none"; } }
    });
    document.querySelectorAll(".gal-tab").forEach(function (b) {
      b.classList.toggle("on", b.getAttribute("data-gal") === cat);
    });
  };
  window.galZoom = function (tile) {
    var img = tile.querySelector("img");
    if (!img || img.style.display === "none" || !img.getAttribute("src")) return;
    var ov = document.getElementById("galLightbox");
    if (!ov) {
      ov = document.createElement("div");
      ov.id = "galLightbox";
      ov.className = "gal-lightbox";
      ov.innerHTML = '<img alt="Enlarged photo">';
      ov.addEventListener("click", function () { ov.classList.remove("open"); });
      document.body.appendChild(ov);
    }
    ov.querySelector("img").src = img.getAttribute("src");
    ov.classList.add("open");
  };

  /* ---- Service accordion (one open at a time) ---- */
  document.querySelectorAll(".svc-acc").forEach(function (acc) {
    acc.querySelectorAll(".acc-head").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var item = btn.closest(".acc-item");
        var willOpen = !item.classList.contains("open");
        acc.querySelectorAll(".acc-item").forEach(function (i) {
          i.classList.remove("open");
          var b = i.querySelector(".acc-head"); if (b) b.setAttribute("aria-expanded", "false");
        });
        if (willOpen) {
          item.classList.add("open");
          btn.setAttribute("aria-expanded", "true");
          var im = item.getAttribute("data-img");
          var svcImg = document.getElementById("svcImg");
          if (im && svcImg) { svcImg.src = im; svcImg.style.display = ""; }
        }
      });
    });
  });

  /* ---- Nav: shadow on scroll ---- */
  var nav = document.getElementById("nav");
  function onScroll() { if (nav) nav.classList.toggle("scrolled", window.scrollY > 8); }
  onScroll();
  window.addEventListener("scroll", onScroll, { passive: true });

  /* ---- Nav: mobile toggle ---- */
  var toggle = document.getElementById("navToggle");
  var mobile = document.getElementById("navMobile");
  if (toggle && mobile) {
    toggle.addEventListener("click", function () {
      var open = mobile.classList.toggle("open");
      toggle.setAttribute("aria-expanded", String(open));
    });
    mobile.querySelectorAll("a").forEach(function (a) {
      a.addEventListener("click", function () {
        mobile.classList.remove("open");
        toggle.setAttribute("aria-expanded", "false");
      });
    });
  }

  /* ---- Scroll reveal ---- */
  var revealEls = document.querySelectorAll(".reveal");
  if ("IntersectionObserver" in window) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); }
      });
    }, { threshold: 0.1 });
    revealEls.forEach(function (el) { io.observe(el); });
  } else {
    revealEls.forEach(function (el) { el.classList.add("in"); });
  }

  /* ---- Stat counters ---- */
  var prefersReduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  function sfx(s) { return s ? '<span class="sfx">' + s + "</span>" : ""; }
  function runCounter(el) {
    var target = parseInt(el.dataset.target, 10) || 0;
    var suffix = el.dataset.suffix || "";
    if (prefersReduced) { el.innerHTML = target + sfx(suffix); return; }
    var dur = 1100, start = performance.now();
    function step(now) {
      var p = Math.min((now - start) / dur, 1);
      var val = Math.round(target * (1 - Math.pow(1 - p, 3)));
      el.innerHTML = val + sfx(suffix);
      if (p < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }
  var counters = document.querySelectorAll(".stat__num");
  if (counters.length) {
    if ("IntersectionObserver" in window) {
      var cIO = new IntersectionObserver(function (entries) {
        entries.forEach(function (e) {
          if (e.isIntersecting) { runCounter(e.target); cIO.unobserve(e.target); }
        });
      }, { threshold: 0.5 });
      counters.forEach(function (c) { cIO.observe(c); });
    } else {
      counters.forEach(runCounter);
    }
  }

  /* ---- Before / after sliders ---- */
  document.querySelectorAll(".ba").forEach(function (ba) {
    var after = ba.querySelector(".ba__after");
    var divider = ba.querySelector(".ba__divider");
    var handle = ba.querySelector(".ba__handle");
    var range = ba.querySelector(".ba__range");
    if (!after || !range) return;
    function set(v) {
      after.style.clipPath = "inset(0 0 0 " + v + "%)";
      if (divider) divider.style.left = v + "%";
      if (handle) handle.style.left = v + "%";
    }
    set(50);
    range.addEventListener("input", function () { set(range.value); });
  });

  /* ---- Quote form (Firestore + mailto fallback) ---- */
  var form = document.getElementById("quoteForm");
  var status = document.getElementById("formStatus");
  var submitBtn = document.getElementById("formSubmit");
  if (form) {
    form.addEventListener("submit", async function (ev) {
      ev.preventDefault();
      status.className = "form__status";
      status.textContent = "";
      var data = Object.fromEntries(new FormData(form).entries());
      if (!(data.name || "").trim() || !(data.email || "").trim() || !(data.message || "").trim()) {
        status.classList.add("err");
        status.textContent = "Add your name, email and a short message.";
        return;
      }
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(data.email)) {
        status.classList.add("err");
        status.textContent = "That email address doesn't look right.";
        return;
      }
      submitBtn.disabled = true;
      submitBtn.textContent = "Sending…";
      try {
        if (firebaseReady) {
          var appMod = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js");
          var fsMod = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js");
          var app = appMod.initializeApp(firebaseConfig, "akaliko-quote");
          var db = fsMod.getFirestore(app);
          await fsMod.addDoc(fsMod.collection(db, INQUIRY_COLLECTION), {
            name: data.name.trim(), company: (data.company || "").trim(),
            email: data.email.trim(), phone: (data.phone || "").trim(),
            service: data.service || data.location || "", message: data.message.trim(),
            createdAt: fsMod.serverTimestamp(), source: "akaliko-png-web"
          });
          form.reset();
          status.classList.add("ok");
          status.textContent = "Request sent. We'll reply within one business day.";
        } else {
          var body = encodeURIComponent(
            "Name: " + data.name + "\nCompany: " + (data.company || "-") + "\nEmail: " + data.email +
            "\nPhone: " + (data.phone || "-") + "\nService: " + (data.service || data.location || "-") + "\n\n" + data.message
          );
          window.location.href = "mailto:" + FALLBACK_EMAIL + "?subject=" +
            encodeURIComponent("Quote request — " + data.name) + "&body=" + body;
          status.classList.add("ok");
          status.textContent = "Opening your email app to send this request…";
        }
      } catch (err) {
        console.error(err);
        status.classList.add("err");
        status.textContent = "Couldn't send just now. Email us at " + FALLBACK_EMAIL + ".";
      } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = "Send request";
      }
    });
  }
})();
