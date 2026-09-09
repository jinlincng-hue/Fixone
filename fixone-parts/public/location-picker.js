(function () {
  const picker = document.querySelector("[data-location-picker]");
  const fallback = document.querySelector("[data-map-fallback]");
  if (!picker || !window.L) return;

  const latitude = document.querySelector("[data-location-lat]");
  const longitude = document.querySelector("[data-location-lng]");
  const searchInput = document.querySelector("[data-location-search]");
  const searchButton = document.querySelector("[data-location-search-button]");
  const locationButton = document.querySelector("[data-current-location]");
  const results = document.querySelector("[data-location-results]");
  let map;
  let marker;

  function setPoint(lat, lng, center = true) {
    const point = [Number(lat), Number(lng)];
    if (!Number.isFinite(point[0]) || !Number.isFinite(point[1])) return;
    latitude.value = point[0].toFixed(6);
    longitude.value = point[1].toFixed(6);
    if (!marker) marker = L.marker(point, { draggable: true }).addTo(map);
    else marker.setLatLng(point);
    if (center) map.setView(point, Math.max(map.getZoom(), 16));
  }

  try {
    const initial = [Number(picker.dataset.lat) || 28.4638705, Number(picker.dataset.lng) || 113.3307214];
    map = L.map(picker, { scrollWheelZoom: false }).setView(initial, 14);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
    }).addTo(map);
    setPoint(initial[0], initial[1], false);
    marker.on("dragend", () => setPoint(marker.getLatLng().lat, marker.getLatLng().lng, false));
    map.on("click", (event) => setPoint(event.latlng.lat, event.latlng.lng, false));
    if (fallback) fallback.textContent = "可搜索地点、使用定位，或拖动标记到门店位置。地图不可用时仍可保存文字地址。";
    window.setTimeout(() => map.invalidateSize(), 100);
  } catch (error) {
    console.warn("地图加载失败", error);
    if (fallback) fallback.textContent = "地图暂时无法加载，可以稍后完善。";
    picker.hidden = true;
    return;
  }

  async function search() {
    const query = searchInput?.value.trim();
    if (!query) return;
    results.textContent = "正在搜索…";
    try {
      const response = await fetch(`/merchant/location-search?q=${encodeURIComponent(query)}`);
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "搜索失败");
      results.innerHTML = "";
      payload.forEach((item) => {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = item.name;
        button.addEventListener("click", () => setPoint(item.lat, item.lng));
        results.appendChild(button);
      });
      if (!payload.length) results.textContent = "没有找到地点，可拖动地图标记。";
    } catch (error) {
      results.textContent = error.message || "地图暂时无法加载，可以稍后完善。";
    }
  }

  searchButton?.addEventListener("click", search);
  searchInput?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      search();
    }
  });
  locationButton?.addEventListener("click", () => {
    if (!navigator.geolocation) {
      if (fallback) fallback.textContent = "当前浏览器不支持定位，可拖动标记选点。";
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => setPoint(position.coords.latitude, position.coords.longitude),
      () => {
        if (fallback) fallback.textContent = "定位未授权或失败，可拖动标记选点。";
      },
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 }
    );
  });
})();
