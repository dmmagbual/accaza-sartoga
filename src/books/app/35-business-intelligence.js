/* The analytics engine is kept outside the core Books bundle so ordinary
   accounting pages retain their startup performance budget. */
PAGES.insights=function(){
  return window.AccazaBusinessIntelligencePage
    ? window.AccazaBusinessIntelligencePage()
    : '<div class="empty"><b>Key Metrics is loading…</b></div>';
};
