// Loaded only by its owning workflow; existing dashboard globals retain their contracts.
export default async function initAtlasPortfolioMap() {
  const mapEl = document.getElementById("atlas-portfolio-map");
  if (!mapEl) {
    destroyAtlasPortfolioMap();
    return;
  }
  if (typeof window.L === "undefined") {
    mapEl.textContent = "Loading map…";
    try { await window.AtlasFeatures.load("leaflet"); }
    catch (error) { if (mapEl.isConnected) mapEl.textContent = error.message; return; }
  }
  if (activeTab !== 0 || document.getElementById("atlas-portfolio-map") !== mapEl) return;
  const details = getAtlasOperationalCommunityNames(true).map(buildCommunityMapDetails);
  const withAddress = details.filter(detail => detail.address);
  for (const detail of withAddress) {
    if (activeTab !== 0 || document.getElementById("atlas-portfolio-map") !== mapEl) return;
    if (!detail.geo) {
      const geo = await geocodeCommunityAddress(detail.name, detail.address);
      if (geo) detail.geo = { lat: Number(geo.lat), lng: Number(geo.lng) };
    }
  }
  if (activeTab !== 0 || document.getElementById("atlas-portfolio-map") !== mapEl) return;
  const mapped = withAddress.filter(detail => detail.geo);
  if (mapped.length === 0) {
    mapEl.innerHTML = `<div style="padding:20px;font-size:0.76rem;color:var(--muted)">Add community addresses in Community Setup to populate the RISE portfolio map.</div>`;
    return;
  }
  destroyAtlasPortfolioMap();
  atlasPortfolioMap = L.map(mapEl, { zoomControl: true, scrollWheelZoom: false }).setView([30.3322, -81.6557], 9);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "&copy; OpenStreetMap contributors"
  }).addTo(atlasPortfolioMap);
  const bounds = [];
  mapped.forEach(detail => {
    const icon = L.divIcon({
      html: createAtlasMarkerHtml(detail.icon, detail.name),
      className: "atlas-marker-wrap",
      iconSize: [34, 34],
      iconAnchor: [17, 17]
    });
    const marker = L.marker([detail.geo.lat, detail.geo.lng], { icon }).addTo(atlasPortfolioMap);
    marker.bindPopup(buildAtlasMapPopup(detail));
    marker.on("mouseover", () => marker.openPopup());
    marker.on("mouseout", () => marker.closePopup());
    atlasPortfolioMapMarkers.push(marker);
    bounds.push([detail.geo.lat, detail.geo.lng]);
  });
  if (bounds.length === 1) {
    atlasPortfolioMap.setView(bounds[0], 11);
  } else if (bounds.length > 1) {
    atlasPortfolioMap.fitBounds(bounds, { padding: [30, 30] });
  }
  setTimeout(() => atlasPortfolioMap?.invalidateSize(), 120);
}
