(function () {
  const el = document.querySelector("#gaoqiao-map");
  if (!el || !window.L) return;

  const center = JSON.parse(el.dataset.center || "{\"lat\":28.4638705,\"lng\":113.3307214,\"zoom\":14}");
  const markers = JSON.parse(el.dataset.markers || "[]");
  const map = L.map(el, {
    scrollWheelZoom: true,
    zoomControl: true
  }).setView([center.lat, center.lng], center.zoom || 14);

  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
  }).addTo(map);

  const markerColors = {
    town: "#ff6a1a",
    shop: "#0a6a5f",
    landmark: "#176bd6"
  };

  markers.forEach((marker) => {
    const color = markerColors[marker.type] || "#0a6a5f";
    const point = L.circleMarker([marker.lat, marker.lng], {
      radius: marker.type === "town" ? 11 : 9,
      color,
      weight: 3,
      fillColor: color,
      fillOpacity: 0.78
    }).addTo(map);

    const detail = marker.href ? `<p><a href="${marker.href}">查看详情</a></p>` : "";
    const verified = marker.verified ? "<p><strong>平台已核验</strong></p>" : "";
    point.bindPopup(`<strong>${marker.title}</strong><p>${marker.description}</p>${verified}${detail}`);
  });

  const bounds = markers.map((marker) => [marker.lat, marker.lng]);
  if (bounds.length > 1) {
    map.fitBounds(bounds, { padding: [34, 34], maxZoom: 15 });
  }
})();
