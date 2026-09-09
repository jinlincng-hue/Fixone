(function () {
  function renderPreviews(input) {
    const target = document.querySelector(input.dataset.previewTarget || "");
    if (!target) return;
    target.innerHTML = "";
    for (const file of Array.from(input.files || [])) {
      const image = document.createElement("img");
      image.alt = "上传图片预览";
      image.src = URL.createObjectURL(file);
      image.addEventListener("load", () => URL.revokeObjectURL(image.src), { once: true });
      target.appendChild(image);
    }
  }

  async function compressImage(file) {
    if (!file.type.startsWith("image/") || file.size < 350 * 1024) return file;
    const image = new Image();
    const objectUrl = URL.createObjectURL(file);
    try {
      await new Promise((resolve, reject) => {
        image.onload = resolve;
        image.onerror = reject;
        image.src = objectUrl;
      });
      const maxDimension = 1920;
      const scale = Math.min(1, maxDimension / Math.max(image.naturalWidth, image.naturalHeight));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      const context = canvas.getContext("2d");
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.84));
      if (!blob || blob.size >= file.size) return file;
      const baseName = file.name.replace(/\.[^.]+$/, "") || "shop-photo";
      return new File([blob], `${baseName}.jpg`, { type: "image/jpeg", lastModified: Date.now() });
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  }

  document.querySelectorAll("[data-compress-image]").forEach((input) => {
    input.addEventListener("change", async () => {
      const originalFiles = Array.from(input.files || []);
      if (!originalFiles.length) return;
      input.dataset.compressing = "true";
      input.closest("label")?.classList.add("is-compressing");
      try {
        const compressed = await Promise.all(originalFiles.map(compressImage));
        const transfer = new DataTransfer();
        compressed.forEach((file) => transfer.items.add(file));
        input.files = transfer.files;
        renderPreviews(input);
      } catch (error) {
        console.warn("图片压缩失败，将上传原图。", error);
        renderPreviews(input);
      } finally {
        delete input.dataset.compressing;
        input.closest("label")?.classList.remove("is-compressing");
      }
    });
  });

  document.querySelectorAll("[data-image-compress-form]").forEach((form) => {
    form.addEventListener("submit", (event) => {
      if (form.querySelector("[data-compressing='true']")) {
        event.preventDefault();
        window.alert("图片正在压缩，请稍候几秒后再提交。");
      }
    });
  });

  const descriptionButton = document.querySelector("[data-description-template]");
  if (descriptionButton) {
    descriptionButton.addEventListener("click", async () => {
      const form = descriptionButton.closest("form");
      const target = form?.querySelector("[data-description-input]");
      if (!form || !target) return;
      descriptionButton.disabled = true;
      try {
        const body = new URLSearchParams(new FormData(form));
        const response = await fetch(descriptionButton.dataset.url, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "生成失败");
        target.value = payload.description || "";
      } catch (error) {
        window.alert(error.message || "暂时无法生成简介，请手动填写。");
      } finally {
        descriptionButton.disabled = false;
      }
    });
  }

  const sortGrid = document.querySelector("[data-media-sort]");
  const orderInput = document.querySelector("[data-media-order]");
  if (sortGrid && orderInput) {
    let dragging = null;
    const updateOrder = () => {
      orderInput.value = Array.from(sortGrid.querySelectorAll("[data-media-id]")).map((item) => item.dataset.mediaId).join(",");
    };
    sortGrid.querySelectorAll("[draggable='true']").forEach((item) => {
      item.addEventListener("dragstart", () => {
        dragging = item;
        item.classList.add("is-dragging");
      });
      item.addEventListener("dragend", () => {
        item.classList.remove("is-dragging");
        dragging = null;
        updateOrder();
      });
      item.addEventListener("dragover", (event) => {
        event.preventDefault();
        if (!dragging || dragging === item) return;
        const after = event.clientY > item.getBoundingClientRect().top + item.offsetHeight / 2;
        sortGrid.insertBefore(dragging, after ? item.nextSibling : item);
      });
    });
  }

  const deliveryFields = document.querySelector("[data-delivery-fields]");
  if (deliveryFields) {
    const tags = Array.from(document.querySelectorAll("input[name='service_tags']"));
    const refresh = () => {
      const active = tags.some((item) => item.checked && ["送货上门", "配送到村"].includes(item.value));
      deliveryFields.hidden = !active;
    };
    tags.forEach((item) => item.addEventListener("change", refresh));
    refresh();
  }

  document.querySelectorAll("form[data-autosave]").forEach((form) => {
    let timer;
    const status = document.createElement("small");
    status.className = "autosave-status";
    form.appendChild(status);
    const collect = () => {
      const values = { step: form.dataset.step };
      new FormData(form).forEach((value, key) => {
        if (value instanceof File) return;
        if (Object.prototype.hasOwnProperty.call(values, key)) {
          values[key] = Array.isArray(values[key]) ? [...values[key], value] : [values[key], value];
        } else {
          values[key] = value;
        }
      });
      return values;
    };
    const save = async () => {
      status.textContent = "正在自动保存…";
      try {
        const response = await fetch(form.dataset.autosaveUrl, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(collect())
        });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "保存失败");
        status.textContent = "草稿已自动保存";
      } catch (error) {
        status.textContent = "自动保存失败，请使用“保存草稿”按钮";
      }
    };
    const schedule = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(save, 900);
    };
    form.addEventListener("input", schedule);
    form.addEventListener("change", schedule);
  });
})();
