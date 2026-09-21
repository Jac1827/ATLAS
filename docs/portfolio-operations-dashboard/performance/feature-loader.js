/* Feature libraries are shared in-flight and never block the dashboard shell. */
(function (root) {
  'use strict';
  const base = new URL('../', document.currentScript.src);
  const pending = new Map();
  const definitions = {
    migrationArchive: { src: new URL("migration-archive.js?v=e4993aad17191ed2", base).href, ready: () => !!root.AtlasMigrationArchive },
    occupancyReplay: { src: new URL("occupancy-replay-browser.js?v=681f9a93e24f41dc", base).href, ready: () => !!root.AtlasOccupancyReplayBrowser },
    leaflet: { src: 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js', css: 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css', ready: () => !!root.L },
    pdf: { src: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js', ready: () => !!root.pdfjsLib },
    zip: { src: new URL('vendor/jszip.min.js?v=acc7e41455a80765', base).href, ready: () => !!root.JSZip },
    pptx: { src: new URL('vendor/pptxgen-4.0.1.js?v=4fb9eac5cfefb213', base).href, ready: () => !!(root.pptxgen || root.PptxGenJS) }
  };
  async function load(name) {
    const definition = definitions[name];
    if (!definition) throw new Error('Unknown ATLAS feature library');
    if (definition.ready()) return;
    if (pending.has(name)) return pending.get(name);
    const finish = root.AtlasPerformance?.start('feature-load', {scope:name});
    const promise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      let done = false;
      const settle = error => {
        if (done) return;
        done = true; clearTimeout(timer); script.onload = script.onerror = null;
        if (error) { script.remove(); finish?.({failed:true}); reject(error); }
        else { finish?.(); resolve(); }
      };
      const timer = setTimeout(() => settle(new Error(`${name} could not load within 20 seconds. Please try this feature again.`)), 20000);
      script.src = definition.src;
      script.async = true;
      script.onload = () => settle(definition.ready() ? null : new Error(`${name} loaded without its expected API.`));
      script.onerror = () => settle(new Error(`${name} could not load. Check your connection and try this feature again.`));
      if (definition.css && !document.querySelector('link[data-atlas-feature="' + name + '"]')) {
        const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = definition.css; css.dataset.atlasFeature = name;
        document.head.appendChild(css);
      }
      document.head.appendChild(script);
    });
    pending.set(name, promise);
    try { await promise; } finally { pending.delete(name); }
  }
  root.AtlasFeatures = Object.freeze({ load });
})(window);
