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
    button.className = "part-btn";

    if (part.name === currentPart) {
      button.classList.add("active");
    }

    button.textContent = part.name;

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

updatePage();
