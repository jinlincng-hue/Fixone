const DEFAULT_QUERY = "电饭煲 不加热";
const HONGJIANG_LEARNING_API =
  window.location.hostname === "127.0.0.1" || window.location.hostname === "localhost"
    ? "http://127.0.0.1:3107/api/volunteer/learning-records"
    : "https://hongjiang.fixone.cloud/api/volunteer/learning-records";
const HONGJIANG_ALLOWED_PARENT_ORIGINS = new Set([
  "https://hongjiang.fixone.cloud",
  "http://127.0.0.1:5173",
  "http://localhost:5173",
]);

function qs(selector, root = document) {
  return root.querySelector(selector);
}

function qsa(selector, root = document) {
  return Array.from(root.querySelectorAll(selector));
}

function escapeHtml(value) {
  const div = document.createElement("div");
  div.textContent = String(value || "");
  return div.innerHTML;
}

function escapeAttribute(value) {
  return escapeHtml(value).replace(/"/g, "&quot;");
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`无法读取 ${url}`);
  return response.json();
}

function getHongjiangVolunteerToken() {
  try {
    return sessionStorage.getItem("hongjiangVolunteerToken") || "";
  } catch (error) {
    return "";
  }
}

window.addEventListener("message", (event) => {
  if (!HONGJIANG_ALLOWED_PARENT_ORIGINS.has(event.origin)) return;
  const data = event.data || {};
  if (data.type !== "hongjiang-volunteer-token" || !data.token) return;
  try {
    sessionStorage.setItem("hongjiangVolunteerToken", String(data.token));
  } catch (error) {
    console.warn("无法暂存红匠志愿者登录状态:", error);
  }
});

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/iphone/g, "iphone")
    .replace(/苹果/g, "iphone");
}

function renderSearchResultThumb(project) {
  var thumbnailUrl = project.thumbnail_file_path || project.thumbnailUrl || "";
  var videoUrl = project.video_file_path || project.videoUrl || "";
  if (thumbnailUrl) {
    return '<span class="search-result-thumb search-result-thumb-loading">' +
      '<img class="search-result-thumb-img" src="' + escapeAttribute(thumbnailUrl) + '" alt="" loading="lazy">' +
    '</span>';
  }
  if (!videoUrl) {
    return '<span class="search-result-thumb search-result-thumb-empty"><span aria-hidden="true">▶</span></span>';
  }
  return '<span class="search-result-thumb search-result-thumb-loading">' +
    '<video class="search-result-thumb-video" src="' + escapeAttribute(videoUrl) + '" muted preload="metadata" playsinline></video>' +
  '</span>';
}

function renderSearchResultCard(project) {
  return '<a class="search-result-card" href="/repair-player.html?projectId=' + escapeAttribute(project.id) + '">' +
    renderSearchResultThumb(project) +
    '<div class="result-card-info">' +
      '<h3>' + escapeHtml(project.title) + '</h3>' +
      '<p>' + escapeHtml(project.category || project.repair_part || "其他") + ' · ' + escapeHtml(project.device_model || project.model || "") + '</p>' +
      '<small>' + escapeHtml(project.uploader_name) + ' · ' + escapeHtml(project.created_at) + '</small>' +
    '</div>' +
    '<span class="result-card-arrow">&rsaquo;</span>' +
  '</a>';
}

function renderSearchSection(title, projects) {
  if (!projects || !projects.length) return "";
  return '<section class="search-result-section">' +
    '<h2>' + escapeHtml(title) + '</h2>' +
    projects.map(renderSearchResultCard).join("") +
  '</section>';
}

function renderSearchResults(data, emptyMsg) {
  var projects = data.projects || [];
  var relatedProjects = data.relatedProjects || [];
  if (!projects.length && !relatedProjects.length) {
    return '<div class="search-result-empty">' + (emptyMsg || "仓库被卖光啦，待进货～") + '</div>';
  }
  return renderSearchSection("最相关", projects) +
    renderSearchSection(projects.length ? "其他相关视频" : "相关视频", relatedProjects);
}

function hydrateSearchThumbnails(root) {
  qsa(".search-result-thumb-img", root).forEach(function (img) {
    var thumb = img.closest(".search-result-thumb");
    if (!thumb) return;

    var markReady = function () {
      thumb.classList.remove("search-result-thumb-loading", "search-result-thumb-empty");
      thumb.classList.add("search-result-thumb-ready");
    };
    var markError = function () {
      thumb.classList.remove("search-result-thumb-loading", "search-result-thumb-ready");
      thumb.classList.add("search-result-thumb-empty");
      thumb.innerHTML = '<span aria-hidden="true">▶</span>';
    };

    if (img.complete && img.naturalWidth > 0) {
      markReady();
    } else {
      img.addEventListener("load", markReady, { once: true });
      img.addEventListener("error", markError, { once: true });
    }
  });

  qsa(".search-result-thumb-video", root).forEach(function (video) {
    var thumb = video.closest(".search-result-thumb");
    var markReady = function () {
      if (!thumb) return;
      thumb.classList.remove("search-result-thumb-loading", "search-result-thumb-empty");
      thumb.classList.add("search-result-thumb-ready");
    };
    var seekToMiddle = function () {
      var duration = Number(video.duration);
      if (!Number.isFinite(duration) || duration <= 0) return;
      try {
        video.currentTime = Math.max(0.1, duration / 2);
      } catch (error) {
        // Some browsers delay seeking until more metadata is available.
      }
    };

    if (video.readyState >= 1) {
      seekToMiddle();
    } else {
      video.addEventListener("loadedmetadata", seekToMiddle, { once: true });
    }

    if (video.readyState >= 2) markReady();
    video.addEventListener("loadeddata", markReady, { once: true });
    video.addEventListener("seeked", markReady, { once: true });

    video.addEventListener("error", function () {
      if (!thumb) return;
      thumb.classList.remove("search-result-thumb-loading", "search-result-thumb-ready");
      thumb.classList.add("search-result-thumb-empty");
      thumb.innerHTML = '<span aria-hidden="true">▶</span>';
    }, { once: true });
  });
}



async function handleHomeSearch(emptyMsg) {
  var input = qs("#searchInput");
  if (!input) return;

  var query = input.value.trim() || DEFAULT_QUERY;
  input.value = query;

  var results = qs("#searchResults");
  var horizontalCard = qs("#warehouseButton");
  var searchLayout = qs("#searchLayout");

  // If no results container exists, navigate to player directly
  if (!results) {
    try {
      var data = await fetchJson("/api/search?q=" + encodeURIComponent(query));
      if (data.projects && data.projects.length > 0) {
        window.location.href = "/repair-player.html?projectId=" + encodeURIComponent(data.projects[0].id);
        return;
      }
      if (data.relatedProjects && data.relatedProjects.length > 0) {
        window.location.href = "/repair-player.html?projectId=" + encodeURIComponent(data.relatedProjects[0].id);
        return;
      }
    } catch (error) {
      console.warn("搜索接口异常:", error);
    }
    alert(emptyMsg || "仓库被卖光啦，待进货～");
    return;
  }

  // Render results inline
  if (horizontalCard) horizontalCard.style.display = "none";
  if (searchLayout) searchLayout.classList.remove("hidden");
  results.innerHTML = '<div class="search-result-loading">搜索中...</div>';

  try {
    var data = await fetchJson("/api/search?q=" + encodeURIComponent(query));
    results.innerHTML = renderSearchResults(data, emptyMsg);
    hydrateSearchThumbnails(results);
  } catch (error) {
    results.innerHTML = '<div class="search-result-empty">搜索失败，请稍后重试</div>';
  }
}


function initHomePage() {
  const form = qs("#searchForm");
  const searchInput = qs("#searchInput");
  const aiButton = qs("#aiButton");
  const warehouseButton = qs("#warehouseButton");

  // 放大镜 / 回车 → 搜索用户输入
  form?.addEventListener("submit", function (event) {
    event.preventDefault();
    handleHomeSearch("未找到相关维修视频，换个关键词试试？");
  });

  searchInput?.addEventListener("keydown", function (event) {
    if (event.key !== "Enter") return;
    event.preventDefault();
    handleHomeSearch("未找到相关维修视频，换个关键词试试？");
  });

  // AI气泡 → 预设热门搜索
  aiButton?.addEventListener("click", function () {
    var input = qs("#searchInput");
    if (input) input.value = DEFAULT_QUERY;
    handleHomeSearch("AI推荐的项目暂未上架，货仓正在补货中～");
  });

  // 进入仓库 → 配件浏览
  warehouseButton?.addEventListener("click", function () {
    alert("配件仓库正在备货中，敬请期待！");
  });

    // Side warehouse button (in search results layout)
  qs("#warehouseButtonSide")?.addEventListener("click", function () {
    alert("配件仓库正在备货中，敬请期待！");
  });

  handleProfileOpen();
}

function renderProfilePanel() {
  const loginOverlay = qs("#loginOverlay");
  const profileContainer = qs("#profileContainer");
  const currentUser = getCurrentUser();

  if (!loginOverlay || !profileContainer) return;

  if (!currentUser) {
    loginOverlay.classList.remove("hidden");
    profileContainer.classList.add("hidden");
    if (qs("#loginUsername")) qs("#loginUsername").value = "";
    if (qs("#loginPassword")) qs("#loginPassword").value = "";
    return;
  }

  loginOverlay.classList.add("hidden");
  profileContainer.classList.remove("hidden");

  qs("#profileNickname").textContent = currentUser.displayName;
  qs("#profileUsername").textContent = "@" + currentUser.username;

  var initials = currentUser.displayName.charAt(0);
  var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">' +
    '<rect width="100" height="100" rx="50" fill="#e6f0ff"/>' +
    '<text x="50" y="62" text-anchor="middle" font-size="34" font-weight="700" fill="#0757ff" font-family="sans-serif">' + escapeHtml(initials) + '</text>' +
    '</svg>';
  qs("#userAvatar").src = "data:image/svg+xml," + encodeURIComponent(svg);

    // 认证勋章仅非普通用户可见
  var badge = qs("#verifiedBadge");
  if (badge) {
    if (currentUser.role && currentUser.role !== "member") {
      badge.classList.remove("hidden");
    } else {
      badge.classList.add("hidden");
    }
  }
  loadMyUploadsGrid();
  loadEmailStatus();
}

async function handleLoginSubmit(event) {
  event.preventDefault();

  var username = qs("#loginUsername").value.trim();
  var password = qs("#loginPassword").value;
  var message = qs("#loginMessage");

  if (!username || !password) {
    message.textContent = "请填写账号和密码。";
    message.className = "form-message error";
    return;
  }

  try {
    var response = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: username, password: password })
    });
    var result = await response.json();

    if (!result.success) {
      message.textContent = result.message;
      message.className = "form-message error";
      return;
    }

    setCurrentUser(result.user);
    message.textContent = "登录成功。";
    message.className = "form-message success";
    renderProfilePanel();
  } catch (error) {
    // Fallback to hardcoded users if API unavailable
    var user = getFixoneUsers().find(function (item) {
      return item.username === username && item.password === password;
    });
    if (!user) {
      message.textContent = "账号或密码不正确。";
      message.className = "form-message error";
      return;
    }
    setCurrentUser({
      username: user.username,
      displayName: user.displayName,
      role: user.role
    });
    message.textContent = "登录成功。";
    message.className = "form-message success";
    renderProfilePanel();
  }
}

async function handleRegisterSubmit(event) {
  event.preventDefault();

  var username = qs("#regUsername").value.trim();
  var displayName = qs("#regDisplayName").value.trim();
  var email = qs("#regEmail").value.trim();
  var password = qs("#regPassword").value;
  var message = qs("#regMessage");

  if (username.length < 3) {
    message.textContent = "账号至少3个字符。";
    message.className = "form-message error";
    return;
  }
  if (!displayName) {
    message.textContent = "昵称不能为空。";
    message.className = "form-message error";
    return;
  }
  if (!/^[\w.%+-]+@[\w.-]+\.[A-Za-z]{2,}$/.test(email)) {
    message.textContent = "请填写正确的邮箱地址，用于找回密码。";
    message.className = "form-message error";
    return;
  }
  if (password.length < 6) {
    message.textContent = "密码至少6位。";
    message.className = "form-message error";
    return;
  }

  try {
    var response = await fetch("/api/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: username, display_name: displayName, email: email, password: password })
    });
    var result = await response.json();

    if (!result.success) {
      message.textContent = result.message;
      message.className = "form-message error";
      return;
    }

    message.textContent = "注册成功！请登录。";
    message.className = "form-message success";
    // Auto-fill login form
    qs("#loginUsername").value = username;
    qs("#loginPassword").value = "";
    // Switch to login view
    qs("#regCard").classList.add("hidden");
    qs("#loginCard").classList.remove("hidden");
  } catch (error) {
    message.textContent = "注册失败，请稍后重试。";
    message.className = "form-message error";
  }
}

// ===== 忘记密码流程 =====
var sendResetCodeCountdown = 0;

function startCodeCountdown(button, seconds) {
  if (!button) return;
  button.disabled = true;
  var remain = seconds;
  var originalText = button.dataset.originalText || button.textContent;
  button.dataset.originalText = originalText;
  button.textContent = `${remain}s 后重发`;
  var timer = setInterval(function () {
    remain -= 1;
    if (remain <= 0) {
      clearInterval(timer);
      button.disabled = false;
      button.textContent = originalText;
    } else {
      button.textContent = `${remain}s 后重发`;
    }
  }, 1000);
}

async function handleSendResetCode() {
  var username = qs("#forgotUsername").value.trim();
  var message = qs("#forgotMessage");
  var button = qs("#sendResetCodeBtn");
  if (!username) {
    message.textContent = "请先输入账号或邮箱。";
    message.className = "form-message error";
    return;
  }
  if (button) { button.disabled = true; button.textContent = "发送中..."; }
  try {
    var response = await fetch("/api/password-reset/request", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: username })
    });
    var result = await response.json();
    message.textContent = result.message;
    message.className = "form-message " + (result.success ? "success" : "error");
    if (result.success) {
      startCodeCountdown(button, 60);
    } else {
      if (button) { button.disabled = false; button.textContent = "发送验证码"; }
    }
  } catch (error) {
    message.textContent = "发送失败，请稍后重试。";
    message.className = "form-message error";
    if (button) { button.disabled = false; button.textContent = "发送验证码"; }
  }
}

async function handleForgotSubmit(event) {
  event.preventDefault();
  var username = qs("#forgotUsername").value.trim();
  var code = qs("#forgotCode").value.trim();
  var password = qs("#forgotPassword").value;
  var message = qs("#forgotMessage");
  if (!username || !code) {
    message.textContent = "请填写账号和验证码。";
    message.className = "form-message error";
    return;
  }
  if (password.length < 6) {
    message.textContent = "新密码至少6位。";
    message.className = "form-message error";
    return;
  }
  try {
    var response = await fetch("/api/password-reset/confirm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: username, code: code, password: password })
    });
    var result = await response.json();
    message.textContent = result.message;
    message.className = "form-message " + (result.success ? "success" : "error");
    if (result.success) {
      setTimeout(function () {
        qs("#forgotCard").classList.add("hidden");
        qs("#loginCard").classList.remove("hidden");
        qs("#loginUsername").value = username;
        qs("#loginPassword").value = "";
      }, 1200);
    }
  } catch (error) {
    message.textContent = "重置失败，请稍后重试。";
    message.className = "form-message error";
  }
}

// ===== 绑定邮箱流程 =====
function loadEmailStatus() {
  var currentUser = getCurrentUser();
  var text = qs("#emailStatusText");
  var input = qs("#bindEmailInput");
  if (!text || !currentUser) return;
  if (currentUser.email) {
    text.textContent = "当前绑定邮箱：" + currentUser.email;
  } else {
    text.textContent = "尚未绑定邮箱，绑定后可用邮箱找回密码。";
  }
  if (input && currentUser.email) input.value = currentUser.email;
}

async function handleSendBindCode() {
  var currentUser = getCurrentUser();
  var password = qs("#bindEmailPassword").value;
  var email = qs("#bindEmailInput").value.trim();
  var message = qs("#bindEmailMessage");
  var button = qs("#sendBindCodeBtn");
  if (!currentUser) return;
  if (!password) { message.textContent = "请输入登录密码。"; message.className = "form-message error"; return; }
  if (!/^[\w.%+-]+@[\w.-]+\.[A-Za-z]{2,}$/.test(email)) {
    message.textContent = "请填写正确的邮箱地址。";
    message.className = "form-message error";
    return;
  }
  if (button) { button.disabled = true; button.textContent = "发送中..."; }
  try {
    var response = await fetch("/api/account/email/code", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: currentUser.username, password: password, email: email })
    });
    var result = await response.json();
    message.textContent = result.message;
    message.className = "form-message " + (result.success ? "success" : "error");
    if (result.success) {
      startCodeCountdown(button, 60);
    } else {
      if (button) { button.disabled = false; button.textContent = "发送验证码"; }
    }
  } catch (error) {
    message.textContent = "发送失败，请稍后重试。";
    message.className = "form-message error";
    if (button) { button.disabled = false; button.textContent = "发送验证码"; }
  }
}

async function handleBindEmailSubmit(event) {
  event.preventDefault();
  var currentUser = getCurrentUser();
  var password = qs("#bindEmailPassword").value;
  var email = qs("#bindEmailInput").value.trim();
  var code = qs("#bindEmailCode").value.trim();
  var message = qs("#bindEmailMessage");
  if (!currentUser) return;
  if (!password || !email || !code) {
    message.textContent = "请填写完整信息。";
    message.className = "form-message error";
    return;
  }
  try {
    var response = await fetch("/api/account/email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: currentUser.username, password: password, email: email, code: code })
    });
    var result = await response.json();
    message.textContent = result.message;
    message.className = "form-message " + (result.success ? "success" : "error");
    if (result.success) {
      // 更新本地缓存的用户信息
      currentUser.email = email;
      setCurrentUser(currentUser);
      loadEmailStatus();
      qs("#bindEmailCode").value = "";
    }
  } catch (error) {
    message.textContent = "绑定失败，请稍后重试。";
    message.className = "form-message error";
  }
}

// 加载当前用户的所有上传项目
async function loadMyUploads() {
  const currentUser = getCurrentUser();
  const list = qs("#myUploadsList");
  if (!currentUser || !list) return;

  try {
    const data = await fetchJson(`/api/my-projects?username=${encodeURIComponent(currentUser.username)}`);
    const projects = data.projects || [];

    if (!projects.length) {
      list.innerHTML = `<div class="empty-state">您还没有上传过任何项目。<br><a href="upload-project.html">前往上传</a></div>`;
      return;
    }

    list.innerHTML = projects.map((p) => `
      <article class="admin-project-card">
        <div>
          <h3>${escapeHtml(p.title)}</h3>
          <p>${escapeHtml(p.category || p.repair_part || "其他")} · ${escapeHtml(p.device_model || p.model || "")}</p>
          <small>${escapeHtml(p.created_at)}</small>
        </div>
        <div class="admin-actions">
          ${statusBadge(p.status)}
          <button class="danger-button delete-project-btn" type="button" data-project-id="${escapeAttribute(p.id)}">删除</button>
        </div>
      </article>
    `).join("");

    // 绑定删除按钮事件
    qsa(".delete-project-btn", list).forEach((btn) => {
      btn.addEventListener("click", () => {
        handleDeleteProject(btn.dataset.projectId, currentUser.username);
      });
    });
  } catch (error) {
    list.innerHTML = `<div class="empty-state">加载失败：${escapeHtml(error.message)}</div>`;
  }
}


// 以网格卡片形式渲染我的上传视频
async function loadMyUploadsGrid() {
  const currentUser = getCurrentUser();
  const grid = qs("#myUploadsGrid");
  const countBadge = qs("#videoCount");
  if (!currentUser || !grid) return;

  try {
    const data = await fetchJson(`/api/my-projects?username=${encodeURIComponent(currentUser.username)}`);
    const projects = data.projects || [];

    if (countBadge) countBadge.textContent = "(" + projects.length + ")";
  var statsUploads = qs("#statUploads");
  if (statsUploads) statsUploads.textContent = projects.length;

    if (!projects.length) {
      grid.innerHTML = '<div class="empty-holder">您还没有上传过任何视频。<br>点击上方“发布视频”开始上传。</div>';
      return;
    }

    grid.innerHTML = projects.map(function (p) {
      var videoUrl = p.video_file_path || p.videoUrl || "";
      var thumbHtml = videoUrl
        ? '<video class="project-thumb-video" src="' + escapeAttribute(videoUrl) + '#t=0.1" muted preload="metadata" playsinline></video>'
        : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">' +
            '<polygon points="23 7 16 12 23 17 23 7"/>' +
            '<rect x="1" y="5" width="15" height="14" rx="2" ry="2"/>' +
          '</svg>';
      return '' +
        '<article class="project-grid-card">' +
          '<div class="project-card-thumb">' +
            '<span class="status-corner status-corner-' + escapeAttribute(p.status) + '">' + escapeHtml(statusLabel(p.status)) + '</span>' +
            thumbHtml +
          '</div>' +
          '<div class="project-card-body">' +
            '<h3>' + escapeHtml(p.title) + '</h3>' +
            '<div class="project-card-meta">' + escapeHtml(p.category || p.repair_part || "其他") + ' · ' + escapeHtml(p.device_model || p.model || "") + '</div>' +
            '<div class="project-card-date">' + escapeHtml(p.created_at) + '</div>' +
            '<div class="project-card-actions">' +
              '<a class="project-edit-btn" href="upload-project.html?edit=' + encodeURIComponent(p.id) + '">重新编辑</a>' +
              '<button class="project-delete-action delete-project-btn" type="button" data-project-id="' + escapeAttribute(p.id) + '">删除</button>' +
            '</div>' +
          '</div>' +
        '</article>';
    }).join("");

    qsa(".delete-project-btn", grid).forEach((btn) => {
      btn.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        handleDeleteProject(btn.dataset.projectId, currentUser.username);
      });
    });
  } catch (error) {
    grid.innerHTML = '<div class="empty-holder">加载失败：' + escapeHtml(error.message) + '</div>';
    if (countBadge) countBadge.textContent = "(0)";
  }
}

// 以网格卡片形式渲染我的商品配件
async function loadMyProductsGrid() {
  const grid = qs("#myProductsGrid");
  const countBadge = qs("#productCount");
  if (!grid) return;

  try {
    const data = await fetchJson("/data/products_demo.json");
    const products = data.products || [];

    if (countBadge) countBadge.textContent = "(" + products.length + ")";

    if (!products.length) {
      grid.innerHTML = '<div class="empty-holder">暂无自主商家上架配件，当前展示官方托管配件。</div>';
      return;
    }

    grid.innerHTML = products.map(function (p) {
      var tagsHtml = (p.tags || []).map(function (t) {
        return '<span>' + escapeHtml(t) + '</span>';
      }).join("");

      return '' +
        '<div class="product-grid-card">' +
          '<div class="product-card-top">' +
            '<span class="product-card-source">' + escapeHtml(p.source) + '</span>' +
            '<span class="product-card-status">已上架</span>' +
            '<button class="product-delete-btn" type="button" data-product-id="' + escapeAttribute(p.id) + '" title="移除此配件">&times;</button>' +
          '</div>' +
          '<div class="product-card-title">' + escapeHtml(p.title) + '</div>' +
          '<div class="product-card-desc">' + escapeHtml(p.description) + '</div>' +
          '<div class="product-card-price">' + escapeHtml(p.price) + '</div>' +
          '<div class="product-card-tags">' + tagsHtml + '</div>' +
        '</div>';
    }).join("");

    // Bind delete buttons for product cards
    qsa(".product-delete-btn", grid).forEach(function (btn) {
      btn.addEventListener("click", function (e) {
        e.stopPropagation();
        if (!confirm("确定要移除此配件吗？")) return;
        var card = btn.closest(".product-grid-card");
        if (card) {
          card.style.opacity = "0";
          card.style.transform = "scale(0.95)";
          card.style.transition = "opacity 0.2s, transform 0.2s";
          setTimeout(function () { card.remove(); updateProductCount(); }, 200);
        }
      });
    });
  } catch (error) {
    grid.innerHTML = '<div class="empty-holder">加载配件失败：' + escapeHtml(error.message) + '</div>';
    if (countBadge) countBadge.textContent = "(0)";
  }
}

// Update product count badge after deletion
function updateProductCount() {
  var grid = qs("#myProductsGrid");
  var badge = qs("#productCount");
  if (!grid || !badge) return;
  var cards = qsa(".product-grid-card", grid);
  badge.textContent = "(" + cards.length + ")";
}
// 确认并删除项目
async function handleDeleteProject(projectId, username) {
  if (!confirm(`确定要删除该维修教学视频吗？\n\n项目 ID: ${projectId}\n\n此操作不可恢复，视频文件将从服务器永久移除。`)) {
    return;
  }

  const list = qs("#myUploadsList");
  const grid = qs("#myUploadsGrid");
  if (list) list.innerHTML = `<div class="empty-state">正在删除...</div>`;
  if (grid) grid.innerHTML = `<div class="empty-holder">正在删除...</div>`;

  try {
    const response = await fetch(`/api/repair-video-projects/${encodeURIComponent(projectId)}?username=${encodeURIComponent(username)}`, {
      method: "DELETE"
    });
    const result = await response.json();

    if (!response.ok || !result.success) {
      throw new Error(result.message || "删除失败");
    }

    // 重新加载列表
    if (grid) {
      await loadMyUploadsGrid();
    } else {
      await loadMyUploads();
    }
  } catch (error) {
    if (list) {
      list.innerHTML = `<div class="empty-state">删除失败：${escapeHtml(error.message)}</div>`;
    }
    if (grid) {
      grid.innerHTML = `<div class="empty-holder">删除失败：${escapeHtml(error.message)}</div>`;
    }
    alert(`删除失败：${error.message}`);
  }
}

function initProfilePage() {
  renderProfilePanel();

  // Login form
  qs("#loginForm")?.addEventListener("submit", handleLoginSubmit);

  // Register form
  qs("#regForm")?.addEventListener("submit", handleRegisterSubmit);

  // Toggle: login <-> register <-> forgot
  qs("#showRegLink")?.addEventListener("click", function () {
    qs("#loginCard").classList.add("hidden");
    qs("#regCard").classList.remove("hidden");
    qs("#loginMessage").textContent = "";
  });
  qs("#showLoginLink")?.addEventListener("click", function () {
    qs("#regCard").classList.add("hidden");
    qs("#loginCard").classList.remove("hidden");
    qs("#regMessage").textContent = "";
  });
  qs("#showForgotLink")?.addEventListener("click", function () {
    qs("#loginCard").classList.add("hidden");
    qs("#forgotCard").classList.remove("hidden");
    qs("#loginMessage").textContent = "";
  });
  qs("#backToLoginLink")?.addEventListener("click", function () {
    qs("#forgotCard").classList.add("hidden");
    qs("#loginCard").classList.remove("hidden");
    qs("#forgotMessage").textContent = "";
  });

  // Forgot password form
  qs("#forgotForm")?.addEventListener("submit", handleForgotSubmit);
  qs("#sendResetCodeBtn")?.addEventListener("click", handleSendResetCode);

  // Bind email form
  qs("#bindEmailForm")?.addEventListener("submit", handleBindEmailSubmit);
  qs("#sendBindCodeBtn")?.addEventListener("click", handleSendBindCode);

  // Logout button
  qs("#logoutBtn")?.addEventListener("click", function () {
    logoutCurrentUser();
    renderProfilePanel();
  });

  // Delete account
  qs("#deleteAccountBtn")?.addEventListener("click", async function () {
    var currentUser = getCurrentUser();
    if (!currentUser) return;
    var password = prompt("确定要永久注销账号吗？此操作不可恢复！\n\n请输入密码确认：");
    if (!password) return;
    try {
      var response = await fetch("/api/account", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: currentUser.username, password: password })
      });
      var result = await response.json();
      if (result.success) {
        alert(result.message);
        logoutCurrentUser();
        renderProfilePanel();
      } else {
        alert(result.message);
      }
    } catch (error) {
      alert("注销失败，请稍后重试。");
    }
  });

  // Go to upload page
  qs("#goToUploadBtn")?.addEventListener("click", () => {
    window.location.href = "upload-project.html";
  });

  // Product upload (MVP: not yet open)
  qs("#goToUploadProductBtn")?.addEventListener("click", () => {
    alert("MVP阶段暂未开放商户自主上传配件，目前由系统官方统一核验上架。");
  });

  // Tab switching
  qsa(".menu-item").forEach(function (item) {
    item.addEventListener("click", function () {
      var target = item.dataset.target;

      // Update active state
      qsa(".menu-item").forEach(function (mi) { mi.classList.remove("active"); });
      item.classList.add("active");

      // Show/hide tab content
      qsa(".profile-tab-content").forEach(function (tab) { tab.classList.add("hidden"); });
      var tabEl = qs("#tab" + target.charAt(0).toUpperCase() + target.slice(1));
      if (tabEl) tabEl.classList.remove("hidden");

      // Load data for the selected tab
      if (target === "videos") loadMyUploadsGrid();
      if (target === "products") loadMyProductsGrid();
      if (target === "settings") loadEmailStatus();
      if (target === "home") window.location.href = "index.html";
    });
  });
}

function requireLoginForUpload() {
  const currentUser = getCurrentUser();
  const locked = qs("#uploadLocked");
  const form = qs("#uploadForm");

  if (!locked || !form) return currentUser;

  if (!currentUser) {
    locked.classList.remove("hidden");
    form.classList.add("hidden");
    return null;
  }

  locked.classList.add("hidden");
  form.classList.remove("hidden");
  return currentUser;
}

function prefillUploaderFromLogin() {
  const currentUser = getCurrentUser();
  if (!currentUser) return;

  const nameInput = qs("#uploaderName");
  const usernameInput = qs("#uploaderUsername");
  if (nameInput) nameInput.value = currentUser.displayName;
  if (usernameInput) usernameInput.value = currentUser.username;
}

function updateSingleVideoPreview(file) {
  const title = qs("#videoUploadTitle");
  const hint = qs("#videoUploadHint");
  const preview = qs("#uploadVideoPreview");
  const previewWrap = qs("#uploadVideoPreviewWrap");
  const zone = qs("#videoDropZone");

  if (!file) {
    if (title) title.textContent = "上传视频";
    if (hint) hint.textContent = "点击或拖拽上传 mp4 / mov / webm";
    if (preview) {
      preview.removeAttribute("src");
    }
    previewWrap?.classList.add("hidden");
    zone?.classList.remove("hidden");
    zone?.classList.remove("has-file");
    return;
  }

  if (title) title.textContent = "已预加载视频";
  if (hint) hint.textContent = `尚未上传，点击“提交审核并上传”后才会上传 · ${file.name} · ${(file.size / 1024 / 1024).toFixed(1)} MB`;
  if (preview) {
    preview.src = URL.createObjectURL(file);
  }
  previewWrap?.classList.remove("hidden");
  zone?.classList.add("hidden");
  zone?.classList.add("has-file");
}

function bindSingleVideoUploader() {
  const input = qs("#singleVideoInput");
  const zone = qs("#videoDropZone");
  const changeButton = qs("#changeVideoButton");
  if (!input || !zone) return;

  input.addEventListener("change", () => {
    updateSingleVideoPreview(input.files?.[0] || null);
  });

  ["dragenter", "dragover"].forEach((eventName) => {
    zone.addEventListener(eventName, (event) => {
      event.preventDefault();
      zone.classList.add("dragging");
    });
  });

  ["dragleave", "drop"].forEach((eventName) => {
    zone.addEventListener(eventName, (event) => {
      event.preventDefault();
      zone.classList.remove("dragging");
    });
  });

  zone.addEventListener("drop", (event) => {
    const file = event.dataTransfer?.files?.[0];
    if (!file) return;
    const transfer = new DataTransfer();
    transfer.items.add(file);
    input.files = transfer.files;
    updateSingleVideoPreview(file);
  });

  changeButton?.addEventListener("click", () => {
    input.click();
  });
}

function setUploadProgress(percent, text) {
  const progress = qs("#uploadProgress");
  const bar = qs("#uploadProgressBar");
  const label = qs("#uploadProgressText");
  const number = qs("#uploadProgressPercent");
  const safePercent = Math.max(0, Math.min(100, Number(percent) || 0));

  if (progress) progress.classList.remove("hidden");
  if (bar) bar.style.width = `${safePercent}%`;
  if (label) label.textContent = text || "正在上传";
  if (number) number.textContent = `${Math.round(safePercent)}%`;
}

function resetUploadProgress() {
  const progress = qs("#uploadProgress");
  const bar = qs("#uploadProgressBar");
  const label = qs("#uploadProgressText");
  const number = qs("#uploadProgressPercent");

  if (progress) progress.classList.add("hidden");
  if (bar) bar.style.width = "0%";
  if (label) label.textContent = "准备上传";
  if (number) number.textContent = "0%";
}

function uploadRepairVideo(formData, options = {}) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const editId = options.editId || "";
    const method = editId ? "PATCH" : "POST";
    const url = editId ? `/api/repair-video-projects/${encodeURIComponent(editId)}` : "/api/repair-video-projects";
    xhr.open(method, url);

    xhr.upload.addEventListener("progress", (event) => {
      if (!event.lengthComputable) {
        setUploadProgress(5, "正在上传视频");
        return;
      }
      const percent = (event.loaded / event.total) * 100;
      if (event.loaded >= event.total) {
        setUploadProgress(100, "上传完成，服务器处理中");
        return;
      }
      setUploadProgress(Math.min(99, percent), "正在上传视频");
    });

    xhr.addEventListener("load", () => {
      let result = {};
      try {
        result = JSON.parse(xhr.responseText || "{}");
      } catch (error) {
        reject(new Error("服务器返回异常，请稍后重试"));
        return;
      }

      if (xhr.status < 200 || xhr.status >= 300 || !result.success) {
        reject(new Error(result.message || "上传失败"));
        return;
      }

      resolve(result);
    });

    xhr.addEventListener("error", () => reject(new Error("网络异常，上传失败")));
    xhr.addEventListener("abort", () => reject(new Error("上传已取消")));

    setUploadProgress(0, "准备上传");
    xhr.send(formData);
  });
}

async function handleUploadSubmit(event) {
  event.preventDefault();

  if (!getCurrentUser()) {
    alert("请先登录后再上传维修视频。");
    return;
  }

  const form = event.currentTarget;
  const submitButton = qs("#submitUploadButton");
  const message = qs("#uploadMessage");
  const formData = new FormData();
  const editId = form.dataset.editProjectId || "";

  try {
    [
      "uploader_name",
      "uploader_username",
      "title",
      "description",
      "category",
      "device_model"
    ].forEach((name) => {
      formData.append(name, form.elements[name].value.trim());
    });

    const file = form.elements.video_file.files?.[0];
    if (!file && !editId) throw new Error("请上传维修教学视频。");
    if (file) formData.append("video_file", file);

    submitButton.disabled = true;
    resetUploadProgress();
    message.textContent = file ? "正在上传视频，请不要关闭页面..." : "正在保存修改...";
    message.className = "form-message";

    const result = await uploadRepairVideo(formData, { editId });
    setUploadProgress(100, editId ? "修改已提交，等待审核" : "提交成功，等待审核");

    message.innerHTML = `${escapeHtml(result.message)}<br><a href="admin-projects.html">前往审核页</a>`;
    message.className = "form-message success";
    form.reset();
    prefillUploaderFromLogin();
    updateSingleVideoPreview(null);
    setTimeout(resetUploadProgress, 1200);
  } catch (error) {
    message.textContent = error.message;
    message.className = "form-message error";
  } finally {
    submitButton.disabled = false;
  }
}

async function initUploadEditMode(currentUser) {
  const params = new URLSearchParams(window.location.search);
  const editId = params.get("edit");
  const form = qs("#uploadForm");
  if (!editId || !form || !currentUser) return;

  const title = qs(".form-title h1");
  const desc = qs(".form-title p");
  const submitButton = qs("#submitUploadButton");
  const input = qs("#singleVideoInput");
  const videoTitle = qs("#videoUploadTitle");
  const videoHint = qs("#videoUploadHint");
  const preview = qs("#uploadVideoPreview");
  const previewWrap = qs("#uploadVideoPreviewWrap");
  const zone = qs("#videoDropZone");
  const message = qs("#uploadMessage");

  try {
    const data = await fetchJson(`/api/repair-video-projects/${encodeURIComponent(editId)}/detail?username=${encodeURIComponent(currentUser.username)}`);
    const project = data.project;

    form.dataset.editProjectId = project.id;
    if (title) title.textContent = "重新编辑维修教学视频";
    if (desc) desc.textContent = "可修改标题、简介、维修大类和设备型号；如需重传视频，再点击上方区域选择新视频。";
    if (submitButton) submitButton.textContent = "提交修改并等待审核";
    if (input) input.required = false;

    form.elements.title.value = project.title || "";
    form.elements.description.value = project.description || "";
    form.elements.category.value = project.category || project.repair_part || "";
    form.elements.device_model.value = project.device_model || project.model || "";

    if (videoTitle) videoTitle.textContent = "当前视频";
    if (videoHint) videoHint.textContent = "不选择新视频则只保存文字修改";
    if (preview && project.video_file_path) {
      preview.src = project.video_file_path + "#t=0.1";
      previewWrap?.classList.remove("hidden");
      zone?.classList.add("hidden");
    }
    zone?.classList.add("has-file");
  } catch (error) {
    if (message) {
      message.textContent = error.message || "加载原视频失败";
      message.className = "form-message error";
    }
  }
}

async function initUploadPage() {
  if (!requireLoginForUpload()) return;
  const currentUser = getCurrentUser();
  prefillUploaderFromLogin();
  bindSingleVideoUploader();
  await initUploadEditMode(currentUser);
  qs("#uploadForm")?.addEventListener("submit", handleUploadSubmit);
}

function statusLabel(status) {
  const labels = {
    pending: "待审核",
    reviewing: "审核中",
    approved: "已通过",
    rejected: "已拒绝",
    needs_reupload: "需重传"
  };
  return labels[status] || status;
}

function statusBadge(status) {
  return `<span class="status-badge status-${escapeAttribute(status)}">${escapeHtml(statusLabel(status))}</span>`;
}

async function loadAdminProjects() {
  const list = qs("#adminProjectList");
  if (!list) return;

  const data = await fetchJson("/api/admin/repair-video-projects");
  list.innerHTML = data.projects.map((project) => `
    <article class="admin-project-card">
      <div>
        <h3>${escapeHtml(project.title)}</h3>
        <p>${escapeHtml(project.uploader_name)} · ${escapeHtml(project.category || project.repair_part || "其他")} · ${escapeHtml(project.device_model || project.model || "")}</p>
        <p>${escapeHtml(project.description || "无简介")}</p>
        <small>${escapeHtml(project.created_at)}</small>
      </div>
      <div class="admin-actions">
        ${statusBadge(project.status)}
        <a class="ghost-link" href="repair-player.html?projectId=${escapeAttribute(project.id)}&admin=true" target="_blank" style="margin-right:8px;">预览</a>
        <button class="primary-button project-status-btn" type="button" data-status="approved" data-project-id="${escapeAttribute(project.id)}">通过</button>
        <button class="ghost-button project-status-btn" type="button" data-status="rejected" data-project-id="${escapeAttribute(project.id)}">拒绝</button>
        <button class="ghost-button project-status-btn" type="button" data-status="needs_reupload" data-project-id="${escapeAttribute(project.id)}">要求重传</button>
      </div>
    </article>
  `).join("") || `<div class="empty-state">暂无上传项目。</div>`;

  qsa(".project-status-btn", list).forEach((button) => {
    button.addEventListener("click", () => updateProjectStatus(button.dataset.projectId, button.dataset.status));
  });
}

async function updateProjectStatus(projectId, status) {
  const response = await fetch(`/api/admin/repair-video-projects/${encodeURIComponent(projectId)}/status`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status })
  });
  const result = await response.json();
  if (!response.ok || !result.success) {
    alert(result.message || "状态更新失败");
    return;
  }
  await loadAdminProjects();
}

function initAdminPage() {
  // MVP 暂不做管理员登录；正式上线前必须加入管理员登录鉴权。
  qs("#refreshAdminProjects")?.addEventListener("click", () => loadAdminProjects());
  loadAdminProjects().catch((error) => {
    qs("#adminProjectList").innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`;
  });
}

const playerState = {
  playlist: [],
  currentIndex: 0,
  products: [],
  projectId: ""
};

// 根据维修部位筛选匹配的虚拟商品卡片
function filterProductsByPart(products, repairPart) {
  if (!repairPart || !products.length) return products;
  const keywords = repairPart.replace(/[^\u4e00-\u9fff]/g, "");
  if (!keywords) return products;
  return products.filter((p) => {
    const searchText = [
      p.title || "",
      p.flowId || "",
      (p.tags || []).join(""),
      p.description || ""
    ].join("").toLowerCase();
    return [...keywords].some((ch) => searchText.includes(ch));
  });
}

function setupHongjiangWatchTracking(video, context) {
  if (!video) return;

  let pendingSeconds = 0;
  let lastWallTime = Date.now();
  let lastVideoTime = Number(video.currentTime) || 0;
  let reporting = false;
  let missingTokenNotified = false;

  function resetTick() {
    lastWallTime = Date.now();
    lastVideoTime = Number(video.currentTime) || 0;
  }

  async function reportLearningTime() {
    const seconds = Math.floor(pendingSeconds / 60) * 60;
    if (seconds < 60 || reporting) return;

    const token = getHongjiangVolunteerToken();
    if (!token) {
      if (!missingTokenNotified && context.message) {
        context.message.textContent = "登录红匠志愿者后，观看时长会同步到我的排行。";
        missingTokenNotified = true;
      }
      return;
    }

    pendingSeconds -= seconds;
    reporting = true;
    try {
      const response = await fetch(HONGJIANG_LEARNING_API, {
        method: "POST",
        headers: {
          "Authorization": "Bearer " + token,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          source: "fixone",
          projectId: context.project?.id,
          projectTitle: context.project?.title || "fixone维修教学",
          clipTitle: context.videoItem?.title || context.videoItem?.clipTitle || context.project?.title || "维修教学视频",
          durationSeconds: seconds,
        }),
      });
      if (!response.ok) {
        pendingSeconds += seconds;
        if (response.status === 401 && context.message) {
          context.message.textContent = "红匠登录已过期，重新进入培训后可继续同步学习时长。";
        }
        return;
      }
      const result = await response.json().catch(() => null);
      if (context.message && result?.credited_minutes) {
        context.message.textContent = "已同步学习时长 " + result.credited_minutes + " 分钟。";
      }
    } catch (error) {
      pendingSeconds += seconds;
      console.warn("同步红匠学习时长失败:", error);
    } finally {
      reporting = false;
    }
  }

  function collectWatchTime() {
    if (video.paused || video.ended || video.readyState < 2) {
      resetTick();
      return;
    }

    const now = Date.now();
    const currentTime = Number(video.currentTime) || 0;
    const wallSeconds = (now - lastWallTime) / 1000;
    const mediaSeconds = currentTime - lastVideoTime;

    if (wallSeconds > 0 && wallSeconds < 10 && mediaSeconds > 0) {
      pendingSeconds += Math.min(wallSeconds, mediaSeconds, 5);
      reportLearningTime();
    }

    lastWallTime = now;
    lastVideoTime = currentTime;
  }

  video.addEventListener("play", resetTick);
  video.addEventListener("seeking", resetTick);
  video.addEventListener("timeupdate", collectWatchTime);
  video.addEventListener("pause", () => {
    collectWatchTime();
    reportLearningTime();
  });
  video.addEventListener("ended", () => {
    collectWatchTime();
    reportLearningTime();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      collectWatchTime();
      reportLearningTime();
    } else {
      resetTick();
    }
  });
  resetTick();
}

async function initRepairPlayerPage() {
  const params = new URLSearchParams(window.location.search);
  const projectId = params.get("projectId");
  const shell = qs("#playerShell");

  if (!projectId) {
    alert("未指定有效的维修项目 ID");
    window.location.href = "index.html";
    return;
  }

  try {
    const data = await fetchJson("/api/repair-video-projects/" + encodeURIComponent(projectId) + "/playlist" + (params.get("admin") === "true" ? "?admin=true" : ""));
    const project = data.project;
    const videoItem = (data.clips || [])[0];
    const titleEl = qs("#playerProjectTitle");
    const metaEl = qs("#playerProjectMeta");
    const categoryEl = qs("#playerCategory");
    const descEl = qs("#playerProjectDescription");
    const video = qs("#repairVideo");
    const message = qs("#playerMessage");
    playerState.projectId = project.id;

    if (titleEl) titleEl.textContent = project.title || "维修教学视频";
    if (categoryEl) categoryEl.textContent = project.category || "维修教学";
    if (metaEl) {
      const parts = [];
      if (project.device_model) parts.push(project.device_model);
      if (project.uploader_name) parts.push(`上传：${project.uploader_name}`);
      if (project.created_at) parts.push(project.created_at);
      metaEl.textContent = parts.join("  ·  ");
    }
    if (descEl) descEl.textContent = project.description || "暂无简介";

    if (!videoItem?.videoUrl) {
      shell.innerHTML = `
        <div class="results-heading" style="text-align:center; padding: 60px 0;">
          <h1>${escapeHtml(project.title)}</h1>
          <p>${escapeHtml(data.message || "该视频暂不可播放。")}</p>
        </div>
      `;
      return;
    }

    video.src = videoItem.videoUrl;
    if (message) message.textContent = "点击播放器开始学习。";
    setupHevcDetection(video, qs("#hevcWarning"));
    setupHongjiangWatchTracking(video, { project, videoItem, message });
    initVideoComments(project.id);
  } catch (error) {
    console.error("加载播放页失败:", error);
    shell.innerHTML = '<div style="text-align:center;padding:80px 24px;">' +
      '<div style="font-size:48px;margin-bottom:16px;">📦</div>' +
      '<h2 style="color:#0f172a;margin:0 0 8px;">仓库被卖光啦，待进货～</h2>' +
      '<p style="color:#94a3b8;">此项目数据暂未同步到服务器，或已被移除。</p>' +
      '<a href="index.html" style="display:inline-block;margin-top:20px;color:#0757ff;font-weight:700;">← 返回首页</a>' +
      '</div>';
  }
}

function formatCommentDate(value) {
  if (!value) return "刚刚";
  const date = new Date(String(value).replace(" ", "T"));
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function renderVideoComments(comments) {
  const list = qs("#videoCommentList");
  const count = qs("#videoCommentCount");
  if (!list) return;
  if (count) count.textContent = String(comments.length);

  if (!comments.length) {
    list.innerHTML = '<div class="comment-empty">还没有评论，来分享第一条维修经验吧。</div>';
    return;
  }

  list.innerHTML = comments.map((comment) => {
    const displayName = comment.display_name || comment.username || "Fixone 用户";
    const initial = Array.from(displayName)[0] || "F";
    return `
      <article class="comment-item">
        <div class="comment-avatar" aria-hidden="true">${escapeHtml(initial)}</div>
        <div class="comment-content">
          <div class="comment-meta">
            <strong>${escapeHtml(displayName)}</strong>
            <time>${escapeHtml(formatCommentDate(comment.created_at))}</time>
          </div>
          <p>${escapeHtml(comment.content)}</p>
        </div>
      </article>
    `;
  }).join("");
}

async function loadVideoComments(projectId) {
  const list = qs("#videoCommentList");
  try {
    const data = await fetchJson(`/api/repair-video-projects/${encodeURIComponent(projectId)}/comments`);
    renderVideoComments(data.comments || []);
  } catch (error) {
    if (list) list.innerHTML = '<div class="comment-empty">评论暂时无法加载，请稍后刷新。</div>';
  }
}

function initVideoComments(projectId) {
  const form = qs("#videoCommentForm");
  const input = qs("#videoCommentInput");
  const message = qs("#videoCommentMessage");
  const loginState = qs("#videoCommentLoginState");
  const submit = form?.querySelector("button[type='submit']");
  const currentUser = getCurrentUser();
  const canComment = Boolean(currentUser?.sessionToken);

  if (loginState) {
    loginState.innerHTML = canComment
      ? `以 <strong>${escapeHtml(currentUser.displayName || currentUser.username)}</strong> 的身份评论`
      : '<a href="profile.html">登录后参与评论</a>';
  }
  if (input) {
    input.disabled = !canComment;
    input.placeholder = canComment ? "分享你的维修经验或提问……" : "请先登录后再发表评论";
  }
  if (submit) submit.disabled = !canComment;
  if (!canComment && message) message.textContent = currentUser ? "请重新登录以启用安全评论会话" : "登录后可发表评论";

  form?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const content = input?.value.trim() || "";
    if (!canComment) {
      window.location.href = "profile.html";
      return;
    }
    if (!content) {
      message.textContent = "请输入评论内容";
      message.className = "comment-message error";
      return;
    }

    submit.disabled = true;
    submit.textContent = "发表中...";
    try {
      const response = await fetch(`/api/repair-video-projects/${encodeURIComponent(projectId)}/comments`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${currentUser.sessionToken}`
        },
        body: JSON.stringify({ content })
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.message || "评论发表失败");
      input.value = "";
      message.textContent = "评论发表成功";
      message.className = "comment-message success";
      await loadVideoComments(projectId);
    } catch (error) {
      message.textContent = error.message || "评论发表失败，请稍后再试";
      message.className = "comment-message error";
    } finally {
      submit.disabled = false;
      submit.textContent = "发表评论";
    }
  });

  loadVideoComments(projectId);
}



function renderPlaylistSteps() {
  const container = qs("#playerStepsContainer");
  if (!container) return;

  container.innerHTML = playerState.playlist.map((clip, index) => {
    const isActive = index === playerState.currentIndex ? "active" : "";
    return `
      <div class="step-clip-card ${isActive}" data-index="${index}">
        <span class="step-num">步骤 ${String(clip.clipOrder).padStart(2, "0")}</span>
        <span class="step-title">${escapeHtml(clip.clipTitle)}</span>
      </div>
    `;
  }).join("");

  qsa(".step-clip-card", container).forEach((card) => {
    card.addEventListener("click", () => playClipAt(Number(card.dataset.index)));
  });
}

function playClipAt(index) {
  if (index < 0 || index >= playerState.playlist.length) return;
  const video = qs("#repairVideo");
  const message = qs("#playerMessage");
  const clip = playerState.playlist[index];

  playerState.currentIndex = index;
  video.src = clip.videoUrl;
  renderPlaylistSteps();
  message.textContent = `正在播放：${clip.clipTitle}`;
  video.play().catch(() => {
    message.textContent = `已切换到：${clip.clipTitle}。点击播放器开始播放。`;
  });
}

function playNextClip() {
  const nextIndex = playerState.currentIndex + 1;
  if (nextIndex >= playerState.playlist.length) {
    qs("#playerMessage").textContent = "维修流程播放完成。";
    return;
  }
  playClipAt(nextIndex);
}

function playPreviousClip() {
  playClipAt(Math.max(0, playerState.currentIndex - 1));
}

function seekVideo(seconds) {
  const video = qs("#repairVideo");
  if (!video) return;
  video.currentTime = Math.max(0, Math.min((video.duration || video.currentTime + seconds), video.currentTime + seconds));
}


function renderSidebarProducts() {
  const container = qs("#sidebarProductsContainer");
  if (!container) return;
  const products = playerState.products || [];
  if (!products.length) {
    container.innerHTML = `<p class="form-message" style="color:#94a3b8; text-align:center; padding:20px 0;">当前维修部位暂无匹配配件</p>`;
    return;
  }
  container.innerHTML = products.map((product) => `
    <div class="sidebar-product-card">
      <div class="product-img"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="2" y="6" width="20" height="14" rx="2" stroke="#2563eb" stroke-width="1.5"/><path d="M6 6V4a2 2 0 012-2h8a2 2 0 012 2v2" stroke="#2563eb" stroke-width="1.5"/><line x1="10" y1="11" x2="14" y2="11" stroke="#93c5fd" stroke-width="2" stroke-linecap="round"/><line x1="12" y1="9" x2="12" y2="13" stroke="#93c5fd" stroke-width="2" stroke-linecap="round"/></svg></div>
      <div class="product-info">
        <h4 class="product-title">${escapeHtml(product.title)}</h4>
        <span class="product-price">${escapeHtml(product.price)}</span>
      </div>
      <button class="btn-buy" type="button">选用</button>
    </div>
  `).join("");
}

// 黑屏只有声音的错误捕获 —— 检测 H.265/HEVC 编码导致的解码失败
function setupHevcDetection(video, warningEl) {
  if (!video || !warningEl) return;

  const HEVC_WARNING_TEXT =
    "⚠️ 提示：检测到当前视频可能采用了 H.265 (HEVC) 高效编码格式，部分浏览器可能无法正确解码画面（导致黑屏只有声音）。建议您使用最新版 Chrome 浏览器观看，或在上传前使用工具将视频压制为标准 H.264 编码的 MP4 格式。";

  let canvas, ctx, checkInterval;

  // 解码器级错误（完全不支持的编码格式）
  video.addEventListener("error", () => {
    const err = video.error;
    if (
      err &&
      (err.code === MediaError.MEDIA_ERR_DECODE ||
        err.code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED)
    ) {
      warningEl.textContent = HEVC_WARNING_TEXT;
      warningEl.classList.remove("hidden");
    }
  });

  // 画布帧采样：检测"能播放但画面全黑"的情况
  video.addEventListener("play", () => {
    if (checkInterval) return;
    canvas = document.createElement("canvas");
    canvas.width = 160;
    canvas.height = 90;
    ctx = canvas.getContext("2d", { willReadFrequently: true });

    let blankFrames = 0;
    checkInterval = setInterval(() => {
      if (video.paused || video.readyState < 2 || video.currentTime < 0.5) return;
      try {
        ctx.drawImage(video, 0, 0, 160, 90);
        const imageData = ctx.getImageData(0, 0, 160, 90);
        const data = imageData.data;
        let litPixels = 0;
        for (let i = 0; i < data.length; i += 4) {
          if (data[i] > 15 || data[i + 1] > 15 || data[i + 2] > 15) litPixels++;
        }
        if (litPixels < 100) {
          blankFrames++;
          if (blankFrames >= 3) {
            warningEl.textContent = HEVC_WARNING_TEXT;
            warningEl.classList.remove("hidden");
            clearInterval(checkInterval);
            checkInterval = null;
          }
        } else {
          blankFrames = 0;
        }
      } catch (e) {
        // Canvas drawImage 可能因跨域或其他原因失败，忽略
      }
    }, 800);
  });

  video.addEventListener("pause", () => {
    if (checkInterval) {
      clearInterval(checkInterval);
      checkInterval = null;
    }
  });

  // 视频源切换时重置警告
  video.addEventListener("emptied", () => {
    warningEl.classList.add("hidden");
    if (checkInterval) {
      clearInterval(checkInterval);
      checkInterval = null;
    }
  });
}

document.addEventListener("DOMContentLoaded", () => {
  if (qs("#searchForm")) initHomePage();
  if (qs("#profilePage")) initProfilePage();
  if (qs("#uploadPage")) initUploadPage();
  if (qs("#adminPage")) initAdminPage();
  if (qs("#playerPage")) initRepairPlayerPage().catch((error) => {
    qs("#playerShell").innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`;
  });
});


// Password visibility toggle
document.addEventListener("click", function (e) {
  var btn = e.target.closest(".pw-toggle");
  if (!btn) return;
  var input = document.getElementById(btn.dataset.target);
  if (!input) return;
  if (input.type === "password") { input.type = "text"; } else { input.type = "password"; }
});
