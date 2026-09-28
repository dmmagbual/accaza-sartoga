/* Closes the POS module closure opened in 00-shared-state.js. Keep this the last section:
   tools/build-runtime-bundles.mjs concatenates sections in file-name order, and any section
   sorted after the closing line runs outside the POS scope (tests/bundle-closure-check.mjs). */
})();
