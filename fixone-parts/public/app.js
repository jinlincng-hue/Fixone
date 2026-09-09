const loginPrompt = document.querySelector("[data-login-prompt]");
if (loginPrompt) {
  if (localStorage.getItem("guestDismissLogin") === "1") {
    loginPrompt.style.display = "none";
  }
  loginPrompt.querySelectorAll("[data-login-prompt-close]").forEach((button) => {
    button.addEventListener("click", () => {
      loginPrompt.style.display = "none";
      localStorage.setItem("guestDismissLogin", "1");
    });
  });
}

const autoCloseFlash = document.querySelector("[data-auto-close-flash]");
if (autoCloseFlash) {
  window.setTimeout(() => {
    autoCloseFlash.classList.add("is-hiding");
    window.setTimeout(() => autoCloseFlash.remove(), 140);
  }, 600);
}

const publishForm = document.querySelector("[data-publish-form]");
if (publishForm) {
  const kindSelect = publishForm.querySelector("[data-kind-select]");
  const listingFields = publishForm.querySelector("[data-listing-fields]");
  const wantedFields = publishForm.querySelector("[data-wanted-fields]");
  const listingTypeSelect = publishForm.querySelector("[data-listing-type-select]");
  const priceUnitFields = publishForm.querySelector("[data-price-unit-fields]");

  const setMode = () => {
    const wanted = kindSelect ? kindSelect.value === "wanted" : !wantedFields?.hasAttribute("disabled");
    if (listingFields) {
      listingFields.hidden = wanted;
      listingFields.disabled = wanted;
    }
    if (wantedFields) {
      wantedFields.hidden = !wanted;
      wantedFields.disabled = !wanted;
    }
  };

  if (kindSelect) {
    kindSelect.addEventListener("change", setMode);
    setMode();
  }

  const setFarmFields = () => {
    if (!listingTypeSelect || !priceUnitFields) return;
    const isFarm = listingTypeSelect.value === "farm";
    priceUnitFields.hidden = isFarm;
    priceUnitFields.querySelectorAll("input, select").forEach((field) => {
      field.disabled = isFarm;
    });
  };

  if (listingTypeSelect) {
    listingTypeSelect.addEventListener("change", setFarmFields);
    setFarmFields();
  }
}

document.querySelectorAll("[data-image-upload]").forEach((uploader) => {
  const input = uploader.querySelector("[data-image-input]");
  const grid = uploader.querySelector("[data-image-grid]");
  const addButton = uploader.querySelector("[data-add-image]");
  const count = uploader.querySelector("[data-image-count]");
  const message = uploader.querySelector("[data-image-message]");
  const form = uploader.closest("form");
  const maxImages = Number(uploader.dataset.maxImages) || 12;
  let newFiles = [];

  if (!input || !grid || !addButton) return;

  const setMessage = (value) => {
    if (message) message.textContent = value || "";
  };

  const syncInput = () => {
    try {
      const transfer = new DataTransfer();
      newFiles.forEach((file) => transfer.items.add(file));
      input.files = transfer.files;
    } catch (error) {
      setMessage("当前浏览器不支持分批添加，请一次选择要上传的图片。 ");
    }
  };

  const updateLabels = () => {
    const cards = [...grid.querySelectorAll("[data-image-card]")];
    cards.forEach((card, index) => {
      const label = card.querySelector("[data-cover-label]");
      if (label) label.hidden = index !== 0;
    });
    const total = cards.length;
    if (count) count.textContent = `已添加 ${total}/${maxImages}`;
    addButton.hidden = total >= maxImages;
  };

  const addPreviewCard = (file) => {
    const card = document.createElement("article");
    card.className = "listing-image-card";
    card.dataset.imageCard = "";
    card.dataset.newImage = "";
    const image = document.createElement("img");
    image.src = URL.createObjectURL(file);
    image.alt = "待上传商品图片";
    image.dataset.objectUrl = image.src;
    const label = document.createElement("span");
    label.className = "image-cover-label";
    label.dataset.coverLabel = "";
    label.textContent = "封面";
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "image-remove-button";
    remove.dataset.removeImage = "";
    remove.setAttribute("aria-label", "删除图片");
    remove.textContent = "×";
    card.append(image, label, remove);
    grid.insertBefore(card, addButton);
  };

  input.addEventListener("change", () => {
    const incoming = [...input.files];
    const current = grid.querySelectorAll("[data-image-card]").length;
    const remaining = Math.max(0, maxImages - current);
    const accepted = incoming.slice(0, remaining);
    newFiles.push(...accepted);
    accepted.forEach(addPreviewCard);
    syncInput();
    setMessage(incoming.length > accepted.length ? `最多上传${maxImages}张图片` : "");
    updateLabels();
  });

  grid.addEventListener("click", (event) => {
    const remove = event.target.closest("[data-remove-image]");
    if (!remove) return;
    const card = remove.closest("[data-image-card]");
    if (!card) return;
    if (card.dataset.newImage !== undefined) {
      const newCards = [...grid.querySelectorAll("[data-new-image]")];
      const index = newCards.indexOf(card);
      if (index >= 0) newFiles.splice(index, 1);
      const objectUrl = card.querySelector("[data-object-url]")?.dataset.objectUrl;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      syncInput();
    }
    card.remove();
    setMessage("");
    updateLabels();
  });

  form?.addEventListener("submit", (event) => {
    const total = grid.querySelectorAll("[data-image-card]").length;
    if (total > maxImages) {
      event.preventDefault();
      setMessage(`最多上传${maxImages}张图片`);
    }
  });

  updateLabels();
});

document.querySelectorAll("[data-product-gallery]").forEach((gallery) => {
  const panel = gallery.closest(".product-gallery-panel");
  const dialog = panel?.querySelector("[data-image-dialog]");
  const dialogImage = dialog?.querySelector("[data-image-dialog-image]");
  const closeButton = dialog?.querySelector("[data-image-dialog-close]");
  if (!dialog || !dialogImage || !closeButton) return;

  gallery.addEventListener("click", (event) => {
    const openButton = event.target.closest("[data-image-open]");
    const image = openButton?.querySelector("img");
    if (!image) return;
    dialogImage.src = image.currentSrc || image.src;
    dialogImage.alt = image.alt;
    if (typeof dialog.showModal === "function") dialog.showModal();
    else dialog.setAttribute("open", "");
  });

  closeButton.addEventListener("click", () => {
    if (typeof dialog.close === "function") dialog.close();
    else dialog.removeAttribute("open");
  });

  dialog.addEventListener("click", (event) => {
    if (event.target !== dialog) return;
    if (typeof dialog.close === "function") dialog.close();
    else dialog.removeAttribute("open");
  });
});

// ===== 图片上传自动压缩 =====
(function () {
  var MAX_WIDTH = 1920;
  var MAX_HEIGHT = 1920;
  var QUALITY = 0.82;

  function compressImage(file) {
    return new Promise(function (resolve) {
      if (!file.type.startsWith('image/') || file.type === 'image/gif') {
        resolve(file);
        return;
      }
      var reader = new FileReader();
      reader.onload = function (e) {
        var img = new Image();
        img.onload = function () {
          var w = img.width, h = img.height;
          if (w > MAX_WIDTH || h > MAX_HEIGHT) {
            var ratio = Math.min(MAX_WIDTH / w, MAX_HEIGHT / h);
            w = Math.round(w * ratio);
            h = Math.round(h * ratio);
          }
          var canvas = document.createElement('canvas');
          canvas.width = w;
          canvas.height = h;
          var ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, w, h);
          canvas.toBlob(function (blob) {
            if (!blob || blob.size >= file.size) {
              resolve(file);
              return;
            }
            var name = file.name.replace(/\.[^.]+$/, '') + '.jpg';
            resolve(new File([blob], name, { type: 'image/jpeg' }));
          }, 'image/jpeg', QUALITY);
        };
        img.onerror = function () { resolve(file); };
        img.src = e.target.result;
      };
      reader.onerror = function () { resolve(file); };
      reader.readAsDataURL(file);
    });
  }

  function hookInput(input) {
    if (input.dataset.compressHooked) return;
    input.dataset.compressHooked = '1';
    input.addEventListener('change', async function () {
      if (!input.files || !input.files.length) return;
      var newFiles = [];
      for (var i = 0; i < input.files.length; i++) {
        var compressed = await compressImage(input.files[i]);
        newFiles.push(compressed);
      }
      var dt = new DataTransfer();
      newFiles.forEach(function (f) { dt.items.add(f); });
      input.files = dt.files;

      // 更新预览
      var previewId = input.dataset.previewTarget;
      if (previewId) {
        var preview = document.querySelector(previewId);
        if (preview && newFiles.length) {
          var url = URL.createObjectURL(newFiles[0]);
          var img = preview.querySelector('img');
          if (img) img.src = url;
        }
      }
    });
  }

  document.querySelectorAll('input[type="file"][accept*="image"]').forEach(hookInput);

  var observer = new MutationObserver(function (mutations) {
    mutations.forEach(function (m) {
      m.addedNodes.forEach(function (node) {
        if (node.nodeType === 1 && node.tagName === 'INPUT' && node.type === 'file' && (node.accept || '').indexOf('image') >= 0) {
          hookInput(node);
        }
        if (node.nodeType === 1 && node.querySelectorAll) {
          node.querySelectorAll('input[type="file"][accept*="image"]').forEach(hookInput);
        }
      });
    });
  });
  observer.observe(document.body, { childList: true, subtree: true });
})();

// ===== 表单提交loading防重复 =====
(function () {
  document.addEventListener('submit', function (e) {
    var form = e.target;
    var btn = form.querySelector('button[type="submit"]');
    if (!btn || btn.disabled) return;
    var originalText = btn.textContent;
    btn.disabled = true;
    btn.dataset.originalText = originalText;
    btn.textContent = '提交中...';
    btn.style.opacity = '0.7';
    btn.style.cursor = 'not-allowed';
    // 5秒后自动恢复（防止提交失败卡住）
    setTimeout(function () {
      if (btn.disabled) {
        btn.disabled = false;
        btn.textContent = originalText;
        btn.style.opacity = '';
        btn.style.cursor = '';
      }
    }, 5000);
  });
})();

// ===== 顶部加载进度条 =====
(function () {
  var bar = document.createElement('div');
  bar.style.cssText = 'position:fixed;top:0;left:0;height:3px;background:linear-gradient(90deg,#0a6a5f,#f5c842);z-index:99999;width:0;transition:width 0.3s ease;box-shadow:0 0 10px rgba(10,106,95,0.5);';
  document.body.appendChild(bar);
  var progress = 0;
  var timer = setInterval(function () {
    progress += Math.random() * 15;
    if (progress > 90) progress = 90;
    bar.style.width = progress + '%';
  }, 100);
  window.addEventListener('load', function () {
    clearInterval(timer);
    bar.style.width = '100%';
    setTimeout(function () { bar.style.opacity = '0'; }, 200);
    setTimeout(function () { bar.remove(); }, 500);
  });
  // 点击链接时显示进度条
  document.addEventListener('click', function (e) {
    var a = e.target.closest('a');
    if (a && a.href && a.href.indexOf(location.hostname) >= 0 && !a.target) {
      var newBar = document.createElement('div');
      newBar.style.cssText = 'position:fixed;top:0;left:0;height:3px;background:linear-gradient(90deg,#0a6a5f,#f5c842);z-index:99999;width:0;transition:width 0.3s ease;';
      document.body.appendChild(newBar);
      var p = 0;
      var t = setInterval(function () {
        p += Math.random() * 20;
        if (p > 90) p = 90;
        newBar.style.width = p + '%';
      }, 80);
    }
  });
})();

// ===== 回到顶部按钮 =====
(function () {
  var btn = document.createElement('button');
  btn.innerHTML = '↑';
  btn.style.cssText = 'position:fixed;bottom:80px;right:20px;width:44px;height:44px;border-radius:50%;background:#0a6a5f;color:#fff;border:0;font-size:20px;cursor:pointer;box-shadow:0 4px 12px rgba(10,106,95,0.3);opacity:0;visibility:hidden;transition:all 0.3s ease;z-index:999;display:flex;align-items:center;justify-content:center;';
  btn.setAttribute('aria-label', '回到顶部');
  document.body.appendChild(btn);
  window.addEventListener('scroll', function () {
    if (window.scrollY > 300) {
      btn.style.opacity = '1';
      btn.style.visibility = 'visible';
    } else {
      btn.style.opacity = '0';
      btn.style.visibility = 'hidden';
    }
  });
  btn.addEventListener('click', function () {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
})();

// ===== 主题切换 =====
(function () {
  function applyTheme(theme) {
    if (theme === "dark" || theme === "light") {
      document.documentElement.setAttribute("data-theme", theme);
      localStorage.setItem("theme", theme);
    } else {
      document.documentElement.removeAttribute("data-theme");
      localStorage.removeItem("theme");
    }
  }

  // 初始化选中状态
  var current = localStorage.getItem("theme") || "auto";
  document.querySelectorAll(input[name=theme]).forEach(function (radio) {
    radio.checked = (radio.value === current);
    radio.addEventListener("change", function () {
      if (radio.checked) applyTheme(radio.value);
    });
  });
})();
