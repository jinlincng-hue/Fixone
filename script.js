const models = [
  "iPhone 17 Pro Max",
  "iPhone 17 Pro",
  "iPhone 17",
  "iPhone Air",
  "iPhone 16 Pro Max",
  "iPhone 16 Pro",
  "iPhone 16 Plus",
  "iPhone 16",
  "iPhone 15 Pro Max",
  "iPhone 15 Pro",
  "iPhone 15 Plus",
  "iPhone 15",
  "iPhone 14 Pro Max",
  "iPhone 14 Pro",
  "iPhone 14 Plus",
  "iPhone 14",
  "iPhone 13 Pro Max",
  "iPhone 13 Pro",
  "iPhone 13",
  "iPhone 13 mini",
  "iPhone 12 Pro Max",
  "iPhone 12 Pro",
  "iPhone 12",
  "iPhone 12 mini",
  "iPhone 11",
  "iPhone X"
];

const parts = [
  { id: "screen", name: "屏幕" },
  { id: "battery", name: "电池" },
  { id: "back", name: "后盖玻璃" },
  { id: "camera", name: "摄像头" },
  { id: "charging", name: "充电口" },
  { id: "speaker", name: "扬声器/听筒" },
  { id: "faceid", name: "Face ID" },
  { id: "button", name: "按键" },
  { id: "board", name: "主板" }
];

const PART_ALIASES = {
  屏幕: ["屏幕", "显示面板", "Screen", "Display"],
  电池: ["电池", "電池", "Battery"],
  后盖玻璃: ["后盖玻璃", "后盖", "後玻璃", "后玻璃", "Back Glass", "Rear Case"],
  摄像头: [
    "摄像头",
    "后置摄像头",
    "前置摄像头",
    "Rear Camera",
    "Rear Cameras",
    "Front Camera",
    "main camera"
  ],
  充电口: [
    "充电口",
    "Lightning 连接器组件",
    "Lightning Connector Assembly",
    "USB-C 端口",
    "Charging Port"
  ],
  扬声器: ["扬声器", "底部扬声器", "Lower Speaker", "Loudspeaker"],
  听筒: [
    "听筒",
    "听筒扬声器",
    "耳机扬声器",
    "耳机扬声器和前传感器组件",
    "Earpiece Speaker",
    "Ear Speaker"
  ],
  "Face ID": ["Face ID", "前传感器", "TrueDepth"],
  按键: ["按键", "Audio Control Cable", "音量", "电源按钮", "Side Button"],
  主板: ["主板", "逻辑板", "邏輯板", "Logic Board"]
};

function getSiteBase() {
  let path = window.location.pathname;
  const lastSegment = path.split("/").pop() || "";
  if (lastSegment.includes(".")) {
    path = path.slice(0, path.lastIndexOf("/") + 1);
  } else if (!path.endsWith("/")) {
    path += "/";
  }
  return path;
}

const IFIXIT_IPHONE_BASE = getSiteBase() + "assets/ifixit/iphone/";
let partThumbIndex = {};

function normalizePartText(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function partNameMatches(alias, scrapedName) {
  const aliasNorm = normalizePartText(alias);
  const scrapedNorm = normalizePartText(scrapedName);
  if (!aliasNorm || !scrapedNorm) return false;
  return (
    scrapedNorm === aliasNorm ||
    scrapedNorm.includes(aliasNorm) ||
    aliasNorm.includes(scrapedNorm)
  );
}

function findCanonicalPart(scrapedName) {
  for (const [canonical, aliases] of Object.entries(PART_ALIASES)) {
    if (aliases.some(alias => partNameMatches(alias, scrapedName))) {
      return canonical;
    }
  }
  return null;
}

function buildThumbSrc(model, filename) {
  const path = `${IFIXIT_IPHONE_BASE}${model}/${filename}`;
  return encodeURI(path);
}

function parseIphoneModel(model) {
  if (model === "iPhone X") return { gen: 10, variant: "base" };
  if (model === "iPhone Air") return { gen: 17, variant: "air" };

  const match = model.match(/iPhone\s+(\d+)\s*(.*)$/i);
  if (!match) return { gen: 0, variant: "base" };

  const variantRaw = (match[2] || "").trim().toLowerCase();
  let variant = "base";
  if (variantRaw.includes("pro max")) variant = "pro max";
  else if (variantRaw.includes("pro")) variant = "pro";
  else if (variantRaw.includes("plus")) variant = "plus";
  else if (variantRaw.includes("mini")) variant = "mini";
  else if (variantRaw.includes("air")) variant = "air";

  return { gen: parseInt(match[1], 10), variant };
}

function variantSimilarity(a, b) {
  if (a === b) return 0;
  const proFamily = new Set(["pro", "pro max"]);
  if (proFamily.has(a) && proFamily.has(b)) return 1;
  if ((a === "base" && b === "plus") || (a === "plus" && b === "base")) return 1;
  if ((a === "base" && b === "mini") || (a === "mini" && b === "base")) return 1;
  return 2;
}

function modelSimilarity(targetModel, candidateModel) {
  const target = parseIphoneModel(targetModel);
  const candidate = parseIphoneModel(candidateModel);
  const genDiff = Math.abs(target.gen - candidate.gen);
  const variantDiff = variantSimilarity(target.variant, candidate.variant);
  const inSidebar =
    models.includes(candidateModel) && models.includes(targetModel) ? 0 : 1;
  return genDiff * 10 + variantDiff * 3 + inSidebar;
}

function getModelSearchOrder(targetModel) {
  return Object.keys(partThumbIndex)
    .filter(model => partThumbIndex[model])
    .sort(
      (a, b) =>
        modelSimilarity(targetModel, a) - modelSimilarity(targetModel, b)
    );
}

function getCanonicalKeysForSitePart(sitePartName) {
  if (sitePartName === "扬声器/听筒") return ["扬声器", "听筒"];
  const canonical = findCanonicalPart(sitePartName);
  if (canonical) return [canonical];
  return [sitePartName];
}

function getThumbForSitePart(model, sitePartName) {
  const partKeys = getCanonicalKeysForSitePart(sitePartName);

  for (const candidateModel of getModelSearchOrder(model)) {
    const modelMap = partThumbIndex[candidateModel];
    if (!modelMap) continue;

    for (const key of partKeys) {
      if (modelMap[key]) {
        return {
          src: modelMap[key],
          fromModel: candidateModel !== model ? candidateModel : null
        };
      }
    }
  }

  return null;
}

async function loadPartThumbs() {
  try {
    const response = await fetch(`${IFIXIT_IPHONE_BASE}all_guides.json`);
    if (!response.ok) return;

    const guides = await response.json();
    if (!Array.isArray(guides)) return;

    const nextIndex = {};

    guides.forEach(entry => {
      const { model, part_name: partName, local_image_filename: filename } =
        entry || {};
      if (!model || !partName || !filename) return;

      const canonical = findCanonicalPart(partName);
      if (!canonical) return;

      if (!nextIndex[model]) nextIndex[model] = {};
      if (nextIndex[model][canonical]) return;

      nextIndex[model][canonical] = buildThumbSrc(model, filename);
    });

    partThumbIndex = nextIndex;
    const modelCount = Object.keys(nextIndex).length;
    if (modelCount > 0) {
      console.info(`已加载 ${modelCount} 个型号的部件缩略图。`);
    }
  } catch (error) {
    console.warn("部件缩略图数据未加载，将仅显示文字。", error);
  }
}

const videos = [
  {
    id: 1,
    brand: "Apple",
    model: "iPhone 13 mini",
    part: "屏幕",
    title: "iPhone 13 mini 屏幕更换维修视频",
    videoUrl: "videos/iiPhone13mini换屏.mp4",
    source: "本地上传",
    difficulty: "中等",
    duration: "待填写"
  },
  {
    id: 2,
    brand: "Apple",
    model: "iPhone 12 Pro Max",
    part: "电池",
    title: "iPhone 12 Pro Max 电池更换维修视频",
    videoUrl: "videos/iPhone 12 Pro Max换电池.mp4",
    source: "本地上传",
    difficulty: "中等",
    duration: "待填写"
  },
  {
    id: 3,
    brand: "Apple",
    model: "iPhone 12",
    part: "屏幕",
    title: "iPhone 12 屏幕总成更换维修视频",
    videoUrl: "videos/iPhone 12，12pro换屏幕总成.mp4",
    source: "本地上传",
    difficulty: "中等",
    duration: "待填写"
  },
  {
    id: 4,
    brand: "Apple",
    model: "iPhone 12 Pro",
    part: "屏幕",
    title: "iPhone 12 Pro 屏幕总成更换维修视频",
    videoUrl: "videos/iPhone 12，12pro换屏幕总成.mp4",
    source: "本地上传",
    difficulty: "中等",
    duration: "待填写"
  },
  {
    id: 5,
    brand: "Apple",
    model: "iPhone 14 Pro Max",
    part: "屏幕",
    title: "iPhone 14 Pro Max 屏幕总成更换维修视频",
    videoUrl: "videos/iPhone 14 Pro Max换总成.mp4",
    source: "本地上传",
    difficulty: "中等",
    duration: "待填写"
  },
  {
    id: 6,
    brand: "Apple",
    model: "iPhone 12",
    part: "电池",
    title: "iPhone 12 电池更换维修视频",
    videoUrl: "videos/iPhone12_12PRO换电池 .mp4",
    source: "本地上传",
    difficulty: "简单",
    duration: "待填写"
  },
  {
    id: 7,
    brand: "Apple",
    model: "iPhone 12 Pro",
    part: "电池",
    title: "iPhone 12 Pro 电池更换维修视频",
    videoUrl: "videos/iPhone12_12PRO换电池 .mp4",
    source: "本地上传",
    difficulty: "简单",
    duration: "待填写"
  },
  {
    id: 8,
    brand: "Apple",
    model: "iPhone 12 Pro Max",
    part: "屏幕",
    title: "iPhone 12 Pro Max 屏幕更换维修视频",
    videoUrl: "videos/iPhone12Pro Max换屏.mp4",
    source: "本地上传",
    difficulty: "中等",
    duration: "待填写"
  },
  {
    id: 9,
    brand: "Apple",
    model: "iPhone 12",
    part: "电池",
    title: "iPhone 12 电池更换维修视频",
    videoUrl: "videos/iPhone12换电池.mp4",
    source: "本地上传",
    difficulty: "简单",
    duration: "待填写"
  },
  {
    id: 10,
    brand: "Apple",
    model: "iPhone 12",
    part: "后盖玻璃",
    title: "iPhone 12 后盖后壳更换维修视频",
    videoUrl: "videos/iphone12换后盖后壳.mp4",
    source: "本地上传",
    difficulty: "较难",
    duration: "待填写"
  },
  {
    id: 11,
    brand: "Apple",
    model: "iPhone 13 mini",
    part: "电池",
    title: "iPhone 13 mini 电池更换维修视频",
    videoUrl: "videos/iPhone13mini更换电池（最详细）.mp4",
    source: "本地上传",
    difficulty: "简单",
    duration: "待填写"
  },
  {
    id: 12,
    brand: "Apple",
    model: "iPhone 13 Pro Max",
    part: "屏幕",
    title: "iPhone 13 Pro Max 屏幕盖板更换维修视频",
    videoUrl: "videos/iPhone13Pro Max更换屏幕盖板教程.mp4",
    source: "本地上传",
    difficulty: "较难",
    duration: "待填写"
  },
  {
    id: 13,
    brand: "Apple",
    model: "iPhone 13 Pro Max",
    part: "电池",
    title: "iPhone 13 Pro Max 电池更换维修视频",
    videoUrl: "videos/iPhone13Pro Max换电池.mp4",
    source: "本地上传",
    difficulty: "中等",
    duration: "待填写"
  },
  {
    id: 14,
    brand: "Apple",
    model: "iPhone 13 Pro",
    part: "电池",
    title: "iPhone 13 Pro 电池更换维修视频",
    videoUrl: "videos/iPhone13pro拆机更换电池.mp4",
    source: "本地上传",
    difficulty: "中等",
    duration: "待填写"
  },
  {
    id: 15,
    brand: "Apple",
    model: "iPhone 13 Pro",
    part: "屏幕",
    title: "iPhone 13 Pro 屏幕总成更换维修视频",
    videoUrl: "videos/iPhone13Pro更换屏幕总成.mp4",
    source: "本地上传",
    difficulty: "中等",
    duration: "待填写"
  },
  {
    id: 16,
    brand: "Apple",
    model: "iPhone 13",
    part: "电池",
    title: "iPhone 13 电池更换维修视频",
    videoUrl: "videos/iPhone13换电池.mp4",
    source: "本地上传",
    difficulty: "简单",
    duration: "待填写"
  },
  {
    id: 17,
    brand: "Apple",
    model: "iPhone 13",
    part: "屏幕",
    title: "iPhone 13 屏幕总成更换维修视频",
    videoUrl: "videos/iPhone13换屏幕总成.mp4",
    source: "本地上传",
    difficulty: "中等",
    duration: "待填写"
  },
  {
    id: 18,
    brand: "Apple",
    model: "iPhone 14 Pro",
    part: "电池",
    title: "iPhone 14 Pro 电池更换维修视频",
    videoUrl: "videos/iPhone14 Pro换电池.mp4",
    source: "本地上传",
    difficulty: "中等",
    duration: "待填写"
  },
  {
    id: 19,
    brand: "Apple",
    model: "iPhone 16 Pro Max",
    part: "电池",
    title: "iPhone 16 Pro Max 电池更换维修视频",
    videoUrl: "videos/iPhone16 Pro Max换电池 .mp4",
    source: "本地上传",
    difficulty: "中等",
    duration: "待填写"
  },
  {
    id: 20,
    brand: "Apple",
    model: "iPhone 11",
    part: "电池",
    title: "iPhone 11 电池更换维修视频",
    videoUrl: "videos/苹果 11 换电池.mp4",
    source: "本地上传",
    difficulty: "简单",
    duration: "待填写"
  },
  {
    id: 21,
    brand: "Apple",
    model: "iPhone 11",
    part: "屏幕",
    title: "iPhone 11 屏幕总成更换维修视频",
    videoUrl: "videos/苹果11换屏幕总成.mp4",
    source: "本地上传",
    difficulty: "中等",
    duration: "待填写"
  },
  {
    id: 22,
    brand: "Apple",
    model: "iPhone 12 mini",
    part: "电池",
    title: "iPhone 12 mini 电池更换维修视频",
    videoUrl: "videos/苹果12mini更换电池教程.mp4",
    source: "本地上传",
    difficulty: "简单",
    duration: "待填写"
  },
  {
    id: 23,
    brand: "Apple",
    model: "iPhone 15",
    part: "电池",
    title: "iPhone 15 电池更换维修视频",
    videoUrl: "videos/苹果15换电池.mp4",
    source: "本地上传",
    difficulty: "简单",
    duration: "待填写"
  },
  {
    id: 24,
    brand: "Apple",
    model: "iPhone X",
    part: "电池",
    title: "iPhone X 电池更换维修视频",
    videoUrl: "videos/苹果X换电池.mp4",
    source: "本地上传",
    difficulty: "简单",
    duration: "待填写"
  },
  {
    id: 25,
    brand: "Apple",
    model: "iPhone X",
    part: "屏幕",
    title: "iPhone X 屏幕总成更换维修视频",
    videoUrl: "videos/苹果X换总成.mp4",
    source: "本地上传",
    difficulty: "中等",
    duration: "待填写"
  }
];

let currentModel = "iPhone 15";
let currentPart = "屏幕";

const modelList = document.getElementById("modelList");
const partList = document.getElementById("partList");
const videoList = document.getElementById("videoList");
const currentModelText = document.getElementById("currentModel");
const currentPartText = document.getElementById("currentPart");
const pageTitle = document.getElementById("pageTitle");
const searchInput = document.getElementById("searchInput");

function renderModels() {
  modelList.innerHTML = "";

  models.forEach(model => {
    const button = document.createElement("button");
    button.className = "model-btn";

    if (model === currentModel) {
      button.classList.add("active");
    }

    button.textContent = model;

    button.onclick = () => {
      currentModel = model;
      updatePage();
    };

    modelList.appendChild(button);
  });
}

function renderParts() {
  partList.innerHTML = "";

  parts.forEach(part => {
    const button = document.createElement("button");
    button.className = "part-btn part-item";

    if (part.name === currentPart) {
      button.classList.add("active");
    }

    const thumb = getThumbForSitePart(currentModel, part.name);
    if (thumb) {
      const img = document.createElement("img");
      img.className = "part-thumb";
      img.src = thumb.src;
      img.alt = "";
      img.loading = "lazy";
      if (thumb.fromModel) {
        img.title = `示意图来自 ${thumb.fromModel}`;
      }
      img.onerror = () => img.remove();
      button.appendChild(img);
    }

    const label = document.createElement("span");
    label.textContent = part.name;
    button.appendChild(label);

    button.onclick = () => {
      currentPart = part.name;
      updatePage();
    };

    partList.appendChild(button);
  });
}

function renderVideos() {
  const keyword = searchInput.value.trim();
  const syntheticTitle = `${currentModel} ${currentPart}维修视频`;

  const matched = videos.filter(
    v => v.model === currentModel && v.part === currentPart
  );

  if (matched.length === 0) {
    videoList.innerHTML = `
      <article class="video-card">
        <div class="video-cover">暂无视频 / 待上传</div>
        <div class="video-info">
          <h3>${syntheticTitle}</h3>
          <p>品牌：Apple</p>
          <p>型号：${currentModel}</p>
          <p>故障部位：${currentPart}</p>
          <p>来源：等待你后续爬取或上传</p>
          <span class="status">待上传</span>
        </div>
      </article>
    `;
    return;
  }

  let toShow = matched;
  if (keyword) {
    toShow = matched.filter(v => {
      const haystack = `${v.title} ${v.model} ${v.part}`.toLowerCase();
      return haystack.includes(keyword.toLowerCase());
    });
  }

  if (keyword && toShow.length === 0) {
    videoList.innerHTML = `<p>没有找到相关视频。</p>`;
    return;
  }

  videoList.innerHTML = toShow
    .map(
      v => `
    <article class="video-card">
      <div class="repair-video-wrap">
        <video class="repair-video" controls playsinline preload="metadata" onerror="this.closest('.video-card').classList.add('video-error')">
          <source src="${encodeURI(v.videoUrl)}" type="video/mp4">
          你的浏览器不支持 video 标签。
        </video>
        <div class="video-error-message">视频加载失败：请检查文件路径或视频编码。</div>
      </div>
      <div class="video-info">
        <h3>${v.title}</h3>
        <p>品牌：${v.brand}</p>
        <p>型号：${v.model}</p>
        <p>故障部位：${v.part}</p>
        <p>来源：${v.source}</p>
        <p>难度：${v.difficulty}</p>
        <p>时长：${v.duration}</p>
        <p>状态：<span class="status status-uploaded">已上传</span></p>
      </div>
    </article>
  `
    )
    .join("");
}

function updatePage() {
  currentModelText.textContent = currentModel;
  currentPartText.textContent = currentPart;
  pageTitle.textContent = `${currentModel} 维修视频`;

  renderModels();
  renderParts();
  renderVideos();
}

searchInput.addEventListener("input", renderVideos);

loadPartThumbs().then(updatePage);
