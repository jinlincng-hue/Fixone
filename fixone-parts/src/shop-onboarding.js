const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const multer = require("multer");

const STEPS = [
  { key: "type", title: "经营方式" },
  { key: "basic", title: "基本信息" },
  { key: "photos", title: "门面与实拍" },
  { key: "location", title: "地址与地图" },
  { key: "contact", title: "联系方式" },
  { key: "services", title: "服务能力" },
  { key: "qualification", title: "资质认证" },
  { key: "preview", title: "预览提交" }
];

const businessModes = {
  verified_store: {
    title: "我家有实体店",
    shortTitle: "认证实体店",
    description: "有固定门面和营业执照，审核通过后普通商品可直接发布。",
    reviewHint: "需提交营业执照并由平台人工审核"
  },
  home_shop: {
    title: "我想开个自家小铺",
    shortTitle: "乡邻小铺",
    description: "没有门店也能卖自家农货、闲置物品，或发布本地服务。",
    reviewHint: "小铺创建后即可展示，发布内容需平台审核"
  }
};

const serviceTags = ["到店购买", "到店自提", "送货上门", "配送到村", "老人免费配送", "支持预订", "支持安装", "支持维修", "支持退换", "可开发票"];
const reviewFieldLabels = {
  type: "经营方式",
  basic: "基本信息",
  photos: "门面与店内实拍",
  location: "地址与地图位置",
  contact: "联系方式和营业信息",
  services: "服务能力",
  qualification: "资质认证"
};
const reviewStatuses = new Set(["draft", "pending", "changes_requested", "approved", "rejected", "suspended"]);
const imageExtensions = new Set([".jpg", ".jpeg", ".png", ".webp"]);

function parseJson(value, fallback) {
  try {
    const parsed = JSON.parse(value || "");
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

function asArray(value) {
  if (Array.isArray(value)) return value;
  return value === undefined || value === null || value === "" ? [] : [value];
}

function imageMagicType(filePath) {
  const bytes = fs.readFileSync(filePath).subarray(0, 16);
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpeg";
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "png";
  if (bytes.length >= 12 && bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP") return "webp";
  return null;
}

function imageExtensionMatches(extension, kind) {
  return (kind === "jpeg" && [".jpg", ".jpeg"].includes(extension)) || (kind === "png" && extension === ".png") || (kind === "webp" && extension === ".webp");
}

function registerShopOnboarding(app, deps) {
  const { db, rootDir, now, text, intId, boolFlag, flash, requireAuth, requireAdmin, renderNotFound, userManagesShop } = deps;
  const publicShopDir = path.join(rootDir, "public", "uploads", "shops");
  const privateCredentialDir = path.join(rootDir, "data", "licenses");
  fs.mkdirSync(publicShopDir, { recursive: true });
  fs.mkdirSync(privateCredentialDir, { recursive: true });

  function diskStorage(destination) {
    return multer.diskStorage({
      destination,
      filename: (req, file, callback) => {
        const extension = path.extname(file.originalname || "").toLowerCase();
        callback(null, `${Date.now()}-${crypto.randomBytes(12).toString("hex")}${extension || ".jpg"}`);
      }
    });
  }

  function createImageUpload(destination, maxFiles) {
    return multer({
      storage: diskStorage(destination),
      limits: { fileSize: 5 * 1024 * 1024, files: maxFiles },
      fileFilter: (req, file, callback) => {
        const extension = path.extname(file.originalname || "").toLowerCase();
        if (!imageExtensions.has(extension) || !String(file.mimetype || "").startsWith("image/")) {
          return callback(new Error("仅支持 jpg、png、webp 图片，单张不超过 5MB。"));
        }
        callback(null, true);
      }
    });
  }

  const uploadShopPhotos = createImageUpload(publicShopDir, 10);
  const uploadCredentials = createImageUpload(privateCredentialDir, 5);
  const uploadClaimCredential = createImageUpload(privateCredentialDir, 1);

  function runUpload(upload, req, res) {
    return new Promise((resolve) => upload(req, res, (error) => resolve(error || null)));
  }

  function uploadedFiles(req) {
    const groups = Object.values(req.files || {});
    return groups.flat();
  }

  function removeFiles(files) {
    for (const file of files || []) {
      try {
        if (file?.path) fs.rmSync(file.path, { force: true });
      } catch (error) {
        console.warn(`无法清理上传文件：${error.message}`);
      }
    }
  }

  function validateImageFiles(files) {
    for (const file of files || []) {
      const extension = path.extname(file.originalname || "").toLowerCase();
      const actual = imageMagicType(file.path);
      if (!actual || !imageExtensionMatches(extension, actual)) {
        return "图片内容与文件扩展名不匹配，已拒绝保存。请重新选择手机相册中的原始图片。";
      }
    }
    return null;
  }

  function safeRemoveInside(directory, filename) {
    const safeName = path.basename(filename || "");
    const target = path.resolve(directory, safeName);
    if (!safeName || !target.startsWith(path.resolve(directory) + path.sep)) return;
    fs.rmSync(target, { force: true });
  }

  function publicImage(filename) {
    return `/uploads/shops/${filename}`;
  }

  function getShop(shopId) {
    return db.prepare("SELECT * FROM shops WHERE id = ?").get(shopId);
  }

  function getDraftForUser(userId, shopId) {
    const shop = getShop(shopId);
    if (!shop || shop.user_id !== userId || !["draft", "changes_requested", "rejected"].includes(shop.review_status)) return null;
    return shop;
  }

  function ownedShopForUser(userId) {
    return db
      .prepare(
        `SELECT DISTINCT s.* FROM shops s
         LEFT JOIN shop_members m ON m.shop_id = s.id AND m.user_id = ? AND m.status = 'active'
         WHERE s.user_id = ? OR (m.user_id = ? AND m.role = 'owner')
         ORDER BY s.updated_at DESC, s.id DESC
         LIMIT 1`
      )
      .get(userId, userId, userId);
  }

  function getShopMedia(shopId) {
    return db.prepare("SELECT * FROM shop_media WHERE shop_id = ? ORDER BY sort_order ASC, id ASC").all(shopId);
  }

  function getCredentials(shopId) {
    return db.prepare("SELECT * FROM shop_credentials WHERE shop_id = ? ORDER BY id DESC").all(shopId);
  }

  function userOwnsShop(userId, shop) {
    if (shop.user_id === userId) return true;
    return Boolean(
      db
        .prepare("SELECT 1 FROM shop_members WHERE shop_id = ? AND user_id = ? AND role = 'owner' AND status = 'active'")
        .get(shop.id, userId)
    );
  }

  function ensureStoreOwner(shopId, userId) {
    db.prepare(
      `INSERT INTO shop_members (shop_id, user_id, role, status, created_at, updated_at)
       VALUES (?, ?, 'owner', 'active', ?, ?)
       ON CONFLICT(shop_id, user_id) DO UPDATE SET role = 'owner', status = 'active', updated_at = excluded.updated_at`
    ).run(shopId, userId, now(), now());
    db.prepare(
      `INSERT INTO store_members (store_id, user_id, role, status, created_at, updated_at)
       VALUES (?, ?, 'owner', 'active', ?, ?)
       ON CONFLICT(store_id, user_id) DO UPDATE SET role = 'owner', status = 'active', updated_at = excluded.updated_at`
    ).run(shopId, userId, now(), now());
  }

  function stepsForShop(shop) {
    const keys = shop.business_mode === "home_shop" ? ["type", "basic", "photos", "contact", "preview"] : ["type", "basic", "photos", "location", "contact", "services", "qualification", "preview"];
    return STEPS.filter((step) => keys.includes(step.key));
  }

  function nextStepForShop(shop, key) {
    const steps = stepsForShop(shop);
    const index = steps.findIndex((step) => step.key === key);
    return steps[Math.min(Math.max(index, 0) + 1, steps.length - 1)].key;
  }

  function generatedHomeShopName(user, village) {
    const prefix = text(user.display_name || user.username, 30) || "乡邻";
    return village ? `${prefix}的${village}乡邻小铺` : `${prefix}的乡邻小铺`;
  }

  function primaryCategoryName(id) {
    const category = id ? db.prepare("SELECT name FROM categories WHERE id = ?").get(id) : null;
    return category?.name || "";
  }

  function shopVerificationLabel(shop) {
    if (shop.business_mode === "home_shop") return "乡邻发布";
    if (shop.review_status !== "approved") return "暂未认证";
    if (shop.business_mode === "verified_store" && shop.verified) return "平台已核验";
    return "暂未认证";
  }

  function updateShopDraft(shopId, values) {
    const fields = Object.keys(values);
    if (!fields.length) return;
    const assignments = fields.map((field) => `${field} = ?`).join(", ");
    db.prepare(`UPDATE shops SET ${assignments}, updated_at = ? WHERE id = ?`).run(...fields.map((field) => values[field]), now(), shopId);
  }

  function renderWizard(req, res, shop, step, options = {}) {
    const media = getShopMedia(shop.id);
    const credentials = getCredentials(shop.id);
    res.render("merchant-wizard", {
      page: "merchant",
      title: "创建店铺",
      shop,
      step,
      steps: stepsForShop(shop),
      media,
      credentials,
      categories: db.prepare("SELECT * FROM categories ORDER BY sort_order, id").all(),
      businessModes,
      serviceTags,
      selectedSecondaryCategories: parseJson(shop.secondary_category_ids, []),
      selectedServiceTags: parseJson(shop.service_tags, []),
      selectedWeekdays: parseJson(shop.weekly_schedule, []),
      verificationLabel: shopVerificationLabel(shop),
      issueFields: parseJson(shop.review_fields, []),
      issueFieldLabels: reviewFieldLabels,
      error: options.error || null
    });
  }

  function renderClaim(req, res, options = {}) {
    const query = text(req.query.q, 80);
    const pattern = `%${query}%`;
    const shops = db
      .prepare(
        `SELECT s.*
         FROM shops s
         WHERE s.review_status = 'approved' AND s.status = 'active' AND s.claimable = 1
           AND (? = '' OR s.name LIKE ? OR s.address LIKE ?)
         ORDER BY s.verified DESC, s.updated_at DESC LIMIT 30`
      )
      .all(query, pattern, pattern);
    res.render("merchant-claim", {
      page: "merchant",
      title: "认领已有店铺",
      shops,
      query,
      error: options.error || null
    });
  }

  function contentReviewQueue() {
    return db
      .prepare(
        `SELECT * FROM (
         SELECT 'product' AS source_type, p.id, p.name AS title, p.description, p.image, p.publication_status, p.review_reason, p.created_at, p.updated_at,
                p.listing_type, s.id AS shop_id, s.name AS shop_name, s.business_mode, u.username AS publisher_name, c.name AS category_name
         FROM products p LEFT JOIN shops s ON s.id = p.shop_id LEFT JOIN users u ON u.id = p.user_id LEFT JOIN categories c ON c.id = p.category_id
         WHERE p.publication_status IN ('pending', 'rejected', 'offline')
         UNION ALL
         SELECT 'listing' AS source_type, l.id, l.name AS title, l.description, l.image, l.publication_status, l.review_reason, l.created_at, l.updated_at,
                l.listing_type, s.id AS shop_id, s.name AS shop_name, s.business_mode, u.username AS publisher_name, c.name AS category_name
         FROM personal_listings l LEFT JOIN shops s ON s.id = l.shop_id LEFT JOIN users u ON u.id = l.user_id LEFT JOIN categories c ON c.id = l.category_id
         WHERE l.publication_status IN ('pending', 'rejected', 'offline')
         UNION ALL
         SELECT 'service' AS source_type, sv.id, sv.title, sv.description, sv.image, sv.publication_status, sv.review_reason, sv.created_at, sv.updated_at,
                sv.listing_type, s.id AS shop_id, s.name AS shop_name, s.business_mode, u.username AS publisher_name, NULL AS category_name
         FROM services sv LEFT JOIN shops s ON s.id = sv.shop_id LEFT JOIN users u ON u.id = sv.user_id
         WHERE sv.publication_status IN ('pending', 'rejected', 'offline')
        )
         ORDER BY CASE publication_status WHEN 'pending' THEN 0 WHEN 'rejected' THEN 1 ELSE 2 END, updated_at DESC`
      )
      .all();
  }

  function validateDraftForSubmit(shop) {
    const media = getShopMedia(shop.id);
    const credentials = getCredentials(shop.id);
    if (!businessModes[shop.business_mode]) return { step: "type", message: "请选择一种经营方式。" };
    if (shop.business_mode === "home_shop") {
      if (!text(shop.name, 120) || !text(shop.village, 80) || !text(shop.description, 1200)) {
        return { step: "basic", message: "请填写小铺名称、所在村和一句话介绍。" };
      }
      if (!text(shop.phone, 40) && !text(shop.contact_wechat, 80) && !shop.allow_consultation) {
        return { step: "contact", message: "乡邻小铺至少需要电话、商家微信或站内咨询其中一种联系方法。" };
      }
      return null;
    }
    if (!text(shop.name, 120) || !shop.primary_category_id || !text(shop.village, 80) || !text(shop.business_state, 30)) {
      return { step: "basic", message: "请补全店铺名称、店铺主要分类、所在村和营业状态。" };
    }
    if (!shop.cover_image || shop.cover_image.includes("shop-placeholder") || media.length < 2) {
      return { step: "photos", message: "请上传一张门面封面和至少两张店内实拍。" };
    }
    if (!text(shop.address, 240)) return { step: "location", message: "请至少保存文字地址；地图暂时无法加载时也可以先填写地址。" };
    if (!text(shop.phone, 40) && !text(shop.contact_wechat, 80) && !shop.allow_consultation) {
      return { step: "contact", message: "店铺至少需要电话、商家微信或平台站内咨询其中一种联系方法。" };
    }
    if (!credentials.some((credential) => credential.credential_type === "business_license")) {
      return { step: "qualification", message: "认证实体店提交审核前必须上传营业执照。" };
    }
    return null;
  }

  app.get("/merchant/apply", requireAuth, (req, res) => {
    const ownedShop = ownedShopForUser(req.user.id);
    if (ownedShop) {
      if (ownedShop.user_id === req.user.id && ["draft", "changes_requested", "rejected"].includes(ownedShop.review_status)) {
        return res.redirect(`/merchant/onboarding/${ownedShop.id}/type`);
      }
      flash(req, "error", "一个账号只能创建一个店铺，请在我的店铺继续管理。 ");
      return res.redirect("/account/shops");
    }
    res.render("merchant-entry", {
      page: "merchant",
      title: "我要开店"
    });
  });

  app.post("/merchant/onboarding/create", requireAuth, (req, res) => {
    const existing = ownedShopForUser(req.user.id);
    if (existing) {
      if (existing.user_id === req.user.id && ["draft", "changes_requested", "rejected"].includes(existing.review_status)) {
        return res.redirect(`/merchant/onboarding/${existing.id}/type`);
      }
      flash(req, "error", "一个账号只能创建一个店铺，请在我的店铺继续管理。 ");
      return res.redirect("/account/shops");
    }
    const result = db
      .prepare(
        `INSERT INTO shops
         (user_id, name, address, phone, business_hours, business_scope, delivery_area, verified, status, logo_image, review_status, merchant_type, business_mode, cover_image, claimable, created_at, updated_at)
         VALUES (?, '未命名店铺', '', '', '', '', '', 0, 'inactive', '/assets/images/shop-placeholder.svg', 'draft', 'unselected', NULL, '/assets/images/shop-placeholder.svg', 0, ?, ?)`
      )
      .run(req.user.id, now(), now());
    ensureStoreOwner(result.lastInsertRowid, req.user.id);
    flash(req, "success", "店铺草稿已创建，会自动保存。完成后再提交审核。 ");
    res.redirect(`/merchant/onboarding/${result.lastInsertRowid}/type`);
  });

  app.get("/merchant/onboarding/:id/type", requireAuth, (req, res) => {
    const shopId = intId(req.params.id);
    const shop = shopId ? getShop(shopId) : null;
    if (!shop || !userOwnsShop(req.user.id, shop)) return renderNotFound(res);
    renderWizard(req, res, shop, "type");
  });

  app.post("/merchant/onboarding/:id/type", requireAuth, (req, res) => {
    const shopId = intId(req.params.id);
    const shop = shopId ? getShop(shopId) : null;
    if (!shop || !userOwnsShop(req.user.id, shop)) return renderNotFound(res);
    const businessMode = businessModes[req.body.business_mode] ? req.body.business_mode : null;
    if (!businessMode) return renderWizard(req, res, shop, "type", { error: "请选择认证实体店或乡邻小铺。" });
    const modeChanged = shop.business_mode && shop.business_mode !== businessMode;
    const submitted = ["pending", "approved", "suspended"].includes(shop.review_status);
    if (modeChanged && submitted && req.body.confirm_mode_change !== "yes") {
      return renderWizard(req, res, shop, "type", { error: "切换经营方式会保留现有资料，但需要重新确认并提交审核。请勾选确认后继续。" });
    }
    const values = {
      business_mode: businessMode,
      merchant_type: businessMode === "verified_store" ? "entity" : "temporary",
      verification_label: businessMode === "home_shop" ? "neighbour" : "unverified"
    };
    if (modeChanged && submitted) {
      Object.assign(values, { review_status: "draft", status: "inactive", verified: 0, review_note: "经营方式已切换，请重新确认资料并提交审核。", review_reason: null, review_fields: JSON.stringify(["type"]) });
    }
    updateShopDraft(shop.id, values);
    flash(req, "success", modeChanged ? "经营方式已更新，原有资料已保留。请继续确认并保存。" : "经营方式已保存。");
    res.redirect(`/merchant/onboarding/${shop.id}/basic`);
  });

  app.get("/merchant/onboarding/:id/:step", requireAuth, (req, res) => {
    const shopId = intId(req.params.id);
    const step = STEPS.some((item) => item.key === req.params.step) ? req.params.step : "type";
    const shop = shopId ? getDraftForUser(req.user.id, shopId) : null;
    if (!shop) return renderNotFound(res);
    if (!businessModes[shop.business_mode]) return res.redirect(`/merchant/onboarding/${shop.id}/type`);
    if (!stepsForShop(shop).some((item) => item.key === step)) return res.redirect(`/merchant/onboarding/${shop.id}/${nextStepForShop(shop, "basic")}`);
    renderWizard(req, res, shop, step);
  });

  app.post("/merchant/onboarding/:id/autosave", requireAuth, (req, res) => {
    const shopId = intId(req.params.id);
    const shop = shopId ? getDraftForUser(req.user.id, shopId) : null;
    if (!shop) return res.status(404).json({ error: "店铺草稿不存在或不可编辑。" });
    const step = text(req.body.step, 30);
    if (step === "basic") {
      const village = text(req.body.village, 80);
      if (shop.business_mode === "home_shop") {
        updateShopDraft(shop.id, {
          name: text(req.body.name, 120) || generatedHomeShopName(req.user, village || shop.village),
          village,
          town: text(req.body.town, 80) || "FixOne配件库",
          description: text(req.body.description, 1200),
          business_scope: "乡邻小铺"
        });
        return res.json({ saved: true, savedAt: now() });
      }
      const primaryCategoryId = intId(req.body.primary_category_id);
      const category = primaryCategoryId ? db.prepare("SELECT name FROM categories WHERE id = ?").get(primaryCategoryId) : null;
      updateShopDraft(shop.id, {
        name: text(req.body.name, 120) || shop.name,
        primary_category_id: primaryCategoryId,
        secondary_category_ids: "[]",
        village,
        town: text(req.body.town, 80) || "FixOne配件库",
        business_state: ["open", "rest", "temporary_rest"].includes(req.body.business_state) ? req.body.business_state : "open",
        description: text(req.body.description, 1200),
        business_scope: category?.name || shop.business_scope
      });
    } else if (step === "location") {
      const village = text(req.body.village, 80) || shop.village;
      const addressDetail = text(req.body.address_detail, 200);
      const address = [text(req.body.province, 40), text(req.body.city, 40), text(req.body.district, 40), text(req.body.town, 80) || "FixOne配件库", village, addressDetail].filter(Boolean).join("");
      const latitude = Number(req.body.latitude);
      const longitude = Number(req.body.longitude);
      updateShopDraft(shop.id, {
        province: text(req.body.province, 40), city: text(req.body.city, 40), district: text(req.body.district, 40), town: text(req.body.town, 80) || "FixOne配件库", village,
        address_detail: addressDetail, address,
        latitude: Number.isFinite(latitude) && latitude >= -90 && latitude <= 90 ? latitude : null,
        longitude: Number.isFinite(longitude) && longitude >= -180 && longitude <= 180 ? longitude : null
      });
    } else if (step === "contact") {
      const weekdays = asArray(req.body.weekly_schedule).map((day) => text(day, 10)).filter((day) => /^[一二三四五六日]$/.test(day));
      const openingTime = text(req.body.opening_time, 10);
      const closingTime = text(req.body.closing_time, 10);
      updateShopDraft(shop.id, {
        phone: text(req.body.phone, 40), contact_wechat: text(req.body.contact_wechat, 80),
        preferred_contact: ["phone", "wechat", "consultation"].includes(req.body.preferred_contact) ? req.body.preferred_contact : "phone",
        public_phone: boolFlag(req.body.public_phone) ? 1 : 0, allow_consultation: boolFlag(req.body.allow_consultation) ? 1 : 0,
        weekly_schedule: JSON.stringify(weekdays), opening_time: openingTime, closing_time: closingTime, noon_break: boolFlag(req.body.noon_break) ? 1 : 0,
        business_state: ["open", "rest", "temporary_rest"].includes(req.body.business_state) ? req.body.business_state : "open",
        business_hours: openingTime && closingTime ? `${openingTime}-${closingTime}` : shop.business_hours
      });
    } else if (step === "services") {
      const tags = [...new Set(asArray(req.body.service_tags).map((tag) => text(tag, 20)).filter((tag) => serviceTags.includes(tag)))];
      const delivery = tags.includes("送货上门") || tags.includes("配送到村");
      const deliveryRadius = Number(req.body.delivery_radius);
      const minimumOrder = Number(req.body.minimum_order);
      const deliveryFee = Number(req.body.delivery_fee);
      updateShopDraft(shop.id, {
        service_tags: JSON.stringify(tags), delivery_area: delivery ? text(req.body.delivery_area, 240) : "",
        delivery_radius: delivery && Number.isFinite(deliveryRadius) && deliveryRadius >= 0 ? deliveryRadius : null,
        minimum_order: delivery && Number.isFinite(minimumOrder) && minimumOrder >= 0 ? minimumOrder : null,
        delivery_fee: delivery && Number.isFinite(deliveryFee) && deliveryFee >= 0 ? deliveryFee : null,
        free_delivery_condition: delivery ? text(req.body.free_delivery_condition, 120) : "",
        delivery_time_note: delivery ? text(req.body.delivery_time_note, 240) : ""
      });
    } else {
      return res.status(400).json({ error: "当前步骤不支持自动保存。" });
    }
    res.json({ saved: true, savedAt: now() });
  });

  app.post("/merchant/onboarding/:id/basic", requireAuth, (req, res) => {
    const shopId = intId(req.params.id);
    const shop = shopId ? getDraftForUser(req.user.id, shopId) : null;
    if (!shop) return renderNotFound(res);
    if (!businessModes[shop.business_mode]) return res.redirect(`/merchant/onboarding/${shop.id}/type`);
    const homeVillage = text(req.body.village, 80);
    const homeName = text(req.body.name, 120) || generatedHomeShopName(req.user, homeVillage || shop.village);
    if (shop.business_mode === "home_shop") {
      if (req.body.action === "next" && (!homeVillage || !text(req.body.description, 1200))) {
        return renderWizard(req, res, { ...shop, ...req.body, name: homeName }, "basic", { error: "请填写所在村和一句话介绍；小铺名称可留空自动生成。" });
      }
      updateShopDraft(shop.id, {
        name: homeName,
        village: homeVillage,
        town: text(req.body.town, 80) || "FixOne配件库",
        description: text(req.body.description, 1200),
        business_scope: "乡邻小铺",
        primary_category_id: null,
        secondary_category_ids: "[]"
      });
      flash(req, "success", "乡邻小铺资料已保存。");
      return res.redirect(`/merchant/onboarding/${shop.id}/${req.body.action === "save" ? "basic" : nextStepForShop(shop, "basic")}`);
    }
    const primaryCategoryId = intId(req.body.primary_category_id);
    const primaryCategory = primaryCategoryId ? db.prepare("SELECT id, name FROM categories WHERE id = ?").get(primaryCategoryId) : null;
    const merchantType = "entity";
    const name = text(req.body.name, 120);
    const village = text(req.body.village, 80);
    const businessState = ["open", "rest", "temporary_rest"].includes(req.body.business_state) ? req.body.business_state : "open";
    if (req.body.action === "next" && (!name || !primaryCategory || !village)) {
      return renderWizard(req, res, { ...shop, ...req.body, primary_category_id: primaryCategoryId }, "basic", { error: "请填写店铺名称、店铺主要分类和所在村或街道。" });
    }
    updateShopDraft(shop.id, {
      name: name || shop.name,
      primary_category_id: primaryCategoryId,
      secondary_category_ids: "[]",
      merchant_type: merchantType,
      village,
      town: text(req.body.town, 80) || "FixOne配件库",
      business_state: businessState,
      description: text(req.body.description, 1200),
      business_scope: primaryCategory?.name || shop.business_scope
    });
    flash(req, "success", "基本信息已保存。 ");
    res.redirect(`/merchant/onboarding/${shop.id}/${req.body.action === "save" ? "basic" : "photos"}`);
  });

  app.post("/merchant/onboarding/:id/description-template", requireAuth, (req, res) => {
    const shopId = intId(req.params.id);
    const shop = shopId ? getDraftForUser(req.user.id, shopId) : null;
    if (!shop) return res.status(404).json({ error: "店铺草稿不存在。" });
    const name = text(req.body.name, 120) || shop.name || "本店";
    const category = primaryCategoryName(intId(req.body.primary_category_id) || shop.primary_category_id) || "本地生活服务";
    const place = [text(req.body.village, 80) || shop.village, text(req.body.town, 80) || shop.town || "FixOne配件库"].filter(Boolean).join("·");
    const tags = asArray(req.body.service_tags).map((tag) => text(tag, 20)).filter((tag) => serviceTags.includes(tag)).slice(0, 3);
    const serviceText = tags.length ? `，支持${tags.join("、")}` : "";
    res.json({ description: `${name}位于${place || "FixOne配件库"}，主营${category}${serviceText}。欢迎到店或提前联系咨询。` });
  });

  app.post("/merchant/onboarding/:id/photos", requireAuth, async (req, res) => {
    const shopId = intId(req.params.id);
    const shop = shopId ? getDraftForUser(req.user.id, shopId) : null;
    if (!shop) return renderNotFound(res);
    const error = await runUpload(uploadShopPhotos.fields([{ name: "cover", maxCount: 1 }, { name: "interior", maxCount: 9 }]), req, res);
    const files = uploadedFiles(req);
    const validationError = error ? (error.code === "LIMIT_FILE_SIZE" ? "图片超过 5MB，请压缩后重试。" : error.message) : validateImageFiles(files);
    const existingMedia = getShopMedia(shop.id);
    if (validationError || existingMedia.length + (req.files?.interior || []).length > 9) {
      removeFiles(files);
      return renderWizard(req, res, shop, "photos", { error: validationError || "店内实拍最多上传 9 张。" });
    }
    const cover = req.files?.cover?.[0];
    if (cover) updateShopDraft(shop.id, { cover_image: publicImage(cover.filename), logo_image: publicImage(cover.filename) });
    const interiors = req.files?.interior || [];
    for (const [index, file] of interiors.entries()) {
      db.prepare("INSERT INTO shop_media (shop_id, media_type, file_path, sort_order, created_at) VALUES (?, 'interior', ?, ?, ?)").run(shop.id, publicImage(file.filename), existingMedia.length + index, now());
    }
    const afterMedia = getShopMedia(shop.id);
    const afterShop = getShop(shop.id);
    if (req.body.action === "next" && afterShop.business_mode === "verified_store" && (!afterShop.cover_image || afterShop.cover_image.includes("shop-placeholder") || afterMedia.length < 2)) {
      return renderWizard(req, res, afterShop, "photos", { error: "请上传一张门面封面和至少两张店内实拍。" });
    }
    flash(req, "success", "门面和店内实拍已保存。 ");
    res.redirect(`/merchant/onboarding/${shop.id}/${req.body.action === "save" ? "photos" : nextStepForShop(afterShop, "photos")}`);
  });

  app.post("/merchant/onboarding/:id/media/:mediaId/delete", requireAuth, (req, res) => {
    const shopId = intId(req.params.id);
    const mediaId = intId(req.params.mediaId);
    const shop = shopId ? getDraftForUser(req.user.id, shopId) : null;
    const media = shop && mediaId ? db.prepare("SELECT * FROM shop_media WHERE id = ? AND shop_id = ?").get(mediaId, shop.id) : null;
    if (!media) return renderNotFound(res);
    db.prepare("DELETE FROM shop_media WHERE id = ?").run(media.id);
    safeRemoveInside(publicShopDir, path.basename(media.file_path));
    flash(req, "success", "店内实拍已删除。 ");
    res.redirect(`/merchant/onboarding/${shop.id}/photos`);
  });

  app.post("/merchant/onboarding/:id/media/order", requireAuth, (req, res) => {
    const shopId = intId(req.params.id);
    const shop = shopId ? getDraftForUser(req.user.id, shopId) : null;
    if (!shop) return renderNotFound(res);
    const ids = String(req.body.media_order || "").split(",").map(intId).filter(Boolean);
    const media = getShopMedia(shop.id);
    if (ids.length !== media.length || new Set(ids).size !== media.length || ids.some((id) => !media.some((item) => item.id === id))) {
      flash(req, "error", "图片排序数据无效，请刷新后重试。 ");
      return res.redirect(`/merchant/onboarding/${shop.id}/photos`);
    }
    const transaction = db.transaction(() => {
      ids.forEach((id, index) => db.prepare("UPDATE shop_media SET sort_order = ? WHERE id = ? AND shop_id = ?").run(index, id, shop.id));
    });
    transaction();
    flash(req, "success", "图片排序已保存。 ");
    res.redirect(`/merchant/onboarding/${shop.id}/photos`);
  });

  app.post("/merchant/onboarding/:id/location", requireAuth, (req, res) => {
    const shopId = intId(req.params.id);
    const shop = shopId ? getDraftForUser(req.user.id, shopId) : null;
    if (!shop) return renderNotFound(res);
    const addressDetail = text(req.body.address_detail, 200);
    const village = text(req.body.village, 80) || shop.village;
    const fullAddress = [text(req.body.province, 40), text(req.body.city, 40), text(req.body.district, 40), text(req.body.town, 80) || "FixOne配件库", village, addressDetail]
      .filter(Boolean)
      .join("");
    if (req.body.action === "next" && !fullAddress) return renderWizard(req, res, { ...shop, ...req.body }, "location", { error: "请至少填写文字地址；地图可以稍后再完善。" });
    const latitude = Number(req.body.latitude);
    const longitude = Number(req.body.longitude);
    updateShopDraft(shop.id, {
      province: text(req.body.province, 40),
      city: text(req.body.city, 40),
      district: text(req.body.district, 40),
      town: text(req.body.town, 80) || "FixOne配件库",
      village,
      address_detail: addressDetail,
      address: fullAddress,
      latitude: Number.isFinite(latitude) && latitude >= -90 && latitude <= 90 ? latitude : null,
      longitude: Number.isFinite(longitude) && longitude >= -180 && longitude <= 180 ? longitude : null
    });
    flash(req, "success", "地址信息已保存。 ");
    res.redirect(`/merchant/onboarding/${shop.id}/${req.body.action === "save" ? "location" : "contact"}`);
  });

  app.get("/merchant/location-search", requireAuth, async (req, res) => {
    const query = text(req.query.q, 160);
    if (!query) return res.json([]);
    try {
      const params = new URLSearchParams({ q: query, format: "jsonv2", limit: "5", countrycodes: "cn", "accept-language": "zh-CN" });
      const response = await fetch(`https://nominatim.openstreetmap.org/search?${params.toString()}`, {
        headers: { "user-agent": "fixone-parts-mvp/1.0 (local marketplace)" }
      });
      if (!response.ok) throw new Error(`地图搜索返回 ${response.status}`);
      const data = await response.json();
      res.json(data.map((item) => ({ name: text(item.display_name, 240), lat: Number(item.lat), lng: Number(item.lon) })).filter((item) => Number.isFinite(item.lat) && Number.isFinite(item.lng)));
    } catch (error) {
      console.warn(`地图搜索不可用：${error.message}`);
      res.status(503).json({ error: "地图暂时无法加载，可以稍后完善。" });
    }
  });

  app.post("/merchant/onboarding/:id/contact", requireAuth, (req, res) => {
    const shopId = intId(req.params.id);
    const shop = shopId ? getDraftForUser(req.user.id, shopId) : null;
    if (!shop) return renderNotFound(res);
    const phone = text(req.body.phone, 40);
    const contactWechat = text(req.body.contact_wechat, 80);
    const allowConsultation = boolFlag(req.body.allow_consultation) ? 1 : 0;
    if (req.body.action === "next" && !phone && !contactWechat && !allowConsultation) {
      return renderWizard(req, res, { ...shop, ...req.body }, "contact", { error: "请至少提供店铺电话、商家微信或开启站内咨询。账号手机号不是店铺联系电话。" });
    }
    if (shop.business_mode === "home_shop") {
      updateShopDraft(shop.id, {
        phone,
        contact_wechat: contactWechat,
        preferred_contact: ["phone", "wechat", "consultation"].includes(req.body.preferred_contact) ? req.body.preferred_contact : "phone",
        public_phone: boolFlag(req.body.public_phone) ? 1 : 0,
        allow_consultation: allowConsultation,
        pickup_location: text(req.body.pickup_location, 160)
      });
      flash(req, "success", "联系方式和常用自提地点已保存。");
      return res.redirect(`/merchant/onboarding/${shop.id}/${req.body.action === "save" ? "contact" : nextStepForShop(shop, "contact")}`);
    }
    const weekdays = asArray(req.body.weekly_schedule).map((day) => text(day, 10)).filter((day) => /^[一二三四五六日]$/.test(day));
    const businessState = ["open", "rest", "temporary_rest"].includes(req.body.business_state) ? req.body.business_state : "open";
    const openingTime = text(req.body.opening_time, 10);
    const closingTime = text(req.body.closing_time, 10);
    updateShopDraft(shop.id, {
      phone,
      contact_wechat: contactWechat,
      preferred_contact: ["phone", "wechat", "consultation"].includes(req.body.preferred_contact) ? req.body.preferred_contact : "phone",
      public_phone: boolFlag(req.body.public_phone) ? 1 : 0,
      allow_consultation: allowConsultation,
      weekly_schedule: JSON.stringify(weekdays),
      opening_time: openingTime,
      closing_time: closingTime,
      noon_break: boolFlag(req.body.noon_break) ? 1 : 0,
      business_state: businessState,
      business_hours: openingTime && closingTime ? `${openingTime}-${closingTime}` : shop.business_hours
    });
    flash(req, "success", "联系方式和营业信息已保存。 ");
    res.redirect(`/merchant/onboarding/${shop.id}/${req.body.action === "save" ? "contact" : nextStepForShop(shop, "contact")}`);
  });

  app.post("/merchant/onboarding/:id/services", requireAuth, (req, res) => {
    const shopId = intId(req.params.id);
    const shop = shopId ? getDraftForUser(req.user.id, shopId) : null;
    if (!shop) return renderNotFound(res);
    const tags = [...new Set(asArray(req.body.service_tags).map((tag) => text(tag, 20)).filter((tag) => serviceTags.includes(tag)))];
    const delivery = tags.includes("送货上门") || tags.includes("配送到村");
    const deliveryRadius = Number(req.body.delivery_radius);
    const minimumOrder = Number(req.body.minimum_order);
    const deliveryFee = Number(req.body.delivery_fee);
    updateShopDraft(shop.id, {
      service_tags: JSON.stringify(tags),
      delivery_area: delivery ? text(req.body.delivery_area, 240) : "",
      delivery_radius: delivery && Number.isFinite(deliveryRadius) && deliveryRadius >= 0 ? deliveryRadius : null,
      minimum_order: delivery && Number.isFinite(minimumOrder) && minimumOrder >= 0 ? minimumOrder : null,
      delivery_fee: delivery && Number.isFinite(deliveryFee) && deliveryFee >= 0 ? deliveryFee : null,
      free_delivery_condition: delivery ? text(req.body.free_delivery_condition, 120) : "",
      delivery_time_note: delivery ? text(req.body.delivery_time_note, 240) : ""
    });
    flash(req, "success", "服务能力已保存。 ");
    res.redirect(`/merchant/onboarding/${shop.id}/${req.body.action === "save" ? "services" : "qualification"}`);
  });

  app.post("/merchant/onboarding/:id/qualification", requireAuth, async (req, res) => {
    const shopId = intId(req.params.id);
    const shop = shopId ? getDraftForUser(req.user.id, shopId) : null;
    if (!shop) return renderNotFound(res);
    const error = await runUpload(uploadCredentials.fields([{ name: "license", maxCount: 1 }, { name: "attachments", maxCount: 4 }]), req, res);
    const files = uploadedFiles(req);
    const validationError = error ? (error.code === "LIMIT_FILE_SIZE" ? "图片超过 5MB，请压缩后重试。" : error.message) : validateImageFiles(files);
    if (validationError) {
      removeFiles(files);
      return renderWizard(req, res, shop, "qualification", { error: validationError });
    }
    const license = req.files?.license?.[0];
    const existingLicense = getCredentials(shop.id).some((credential) => credential.credential_type === "business_license");
    if (req.body.action === "next" && shop.business_mode === "verified_store" && !license && !existingLicense) {
      removeFiles(files);
      return renderWizard(req, res, shop, "qualification", { error: "有营业执照的实体店需要上传营业执照。" });
    }
    updateShopDraft(shop.id, {
      subject_name: text(req.body.subject_name, 120),
      applicant_relation: text(req.body.applicant_relation, 120),
      credit_code: text(req.body.credit_code, 80)
    });
    if (license) {
      db.prepare("INSERT INTO shop_credentials (shop_id, credential_type, file_name, original_name, created_at) VALUES (?, 'business_license', ?, ?, ?)").run(shop.id, license.filename, text(license.originalname, 200), now());
    }
    for (const file of req.files?.attachments || []) {
      db.prepare("INSERT INTO shop_credentials (shop_id, credential_type, file_name, original_name, created_at) VALUES (?, 'other', ?, ?, ?)").run(shop.id, file.filename, text(file.originalname, 200), now());
    }
    flash(req, "success", "资质资料已保存，仅店主和管理员可以查看原图。 ");
    res.redirect(`/merchant/onboarding/${shop.id}/${req.body.action === "save" ? "qualification" : "preview"}`);
  });

  app.post("/merchant/onboarding/:id/submit", requireAuth, (req, res) => {
    const shopId = intId(req.params.id);
    const shop = shopId ? getDraftForUser(req.user.id, shopId) : null;
    if (!shop) return renderNotFound(res);
    const validation = validateDraftForSubmit(shop);
    if (validation) {
      flash(req, "error", validation.message);
      return res.redirect(`/merchant/onboarding/${shop.id}/${validation.step}`);
    }
    if (shop.business_mode === "home_shop") {
      const transaction = db.transaction(() => {
        updateShopDraft(shop.id, {
          review_status: "approved",
          status: "active",
          verified: 0,
          verification_label: "neighbour",
          review_note: null,
          review_reason: null,
          review_fields: null
        });
        ensureStoreOwner(shop.id, req.user.id);
        db.prepare("UPDATE users SET role = CASE WHEN role = 'admin' THEN 'admin' ELSE 'merchant' END, updated_at = ? WHERE id = ?").run(now(), req.user.id);
        db.prepare("INSERT INTO shop_review_events (shop_id, action, note, created_at) VALUES (?, 'home_shop_created', ?, ?)").run(shop.id, "乡邻小铺已创建", now());
      });
      transaction();
      flash(req, "success", "乡邻小铺创建成功，现在可以发布自家农货、闲置或本地服务。");
      return res.redirect(`/merchant/dashboard?shop=${shop.id}`);
    }
    const transaction = db.transaction(() => {
      updateShopDraft(shop.id, { review_status: "pending", status: "inactive", review_note: null, review_reason: null, review_fields: null });
      db.prepare("INSERT INTO shop_review_events (shop_id, action, note, created_at) VALUES (?, 'submitted', ?, ?)").run(shop.id, "商家提交审核", now());
    });
    transaction();
    flash(req, "success", "店铺资料已提交，等待平台人工审核。 ");
    res.redirect("/merchant/progress");
  });

  app.get("/merchant/progress", requireAuth, (req, res) => {
    const shops = db
      .prepare("SELECT * FROM shops WHERE user_id = ? ORDER BY updated_at DESC")
      .all(req.user.id)
      .map((shop) => {
        const issueFields = parseJson(shop.review_fields, []);
        return { ...shop, review_start_step: STEPS.find((step) => issueFields.includes(step.key))?.key || "basic" };
      });
    const claims = db
      .prepare(
        `SELECT c.*, s.name AS shop_name, s.address, s.cover_image
         FROM shop_claim_applications c JOIN shops s ON s.id = c.shop_id
         WHERE c.user_id = ? ORDER BY c.updated_at DESC`
      )
      .all(req.user.id);
    res.render("merchant-progress", {
      page: "merchant",
      title: "审核进度",
      shops,
      claims,
      verificationLabel: shopVerificationLabel
    });
  });

  app.get("/merchant/claim", requireAuth, (req, res) => renderClaim(req, res));

  app.post("/merchant/claims", requireAuth, async (req, res) => {
    if (ownedShopForUser(req.user.id)) {
      return renderClaim(req, res, { error: "一个账号只能拥有一个店铺，不能再提交认领申请。" });
    }
    const error = await runUpload(uploadClaimCredential.single("license"), req, res);
    const files = req.file ? [req.file] : [];
    const shopId = intId(req.body.shop_id);
    const shop = shopId ? db.prepare("SELECT * FROM shops WHERE id = ? AND review_status = 'approved' AND status = 'active' AND claimable = 1").get(shopId) : null;
    if (!shop || userManagesShop(req.user.id, shopId)) {
      removeFiles(files);
      return renderClaim(req, res, { error: "请选择一个尚未由当前账号管理的店铺。" });
    }
    const validationError = error ? (error.code === "LIMIT_FILE_SIZE" ? "图片超过 5MB，请压缩后重试。" : error.message) : validateImageFiles(files);
    const relation = text(req.body.relationship, 120);
    const inviteCode = text(req.body.invite_code, 80);
    if (validationError || !relation || (!inviteCode && !req.file)) {
      removeFiles(files);
      return renderClaim(req, res, { error: validationError || "请填写与店铺的关系，并提供平台邀请码或营业执照。" });
    }
    db.prepare(
      `INSERT INTO shop_claim_applications
       (shop_id, user_id, relationship, invite_code, license_file_name, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)
       ON CONFLICT(shop_id, user_id) DO UPDATE SET relationship = excluded.relationship, invite_code = excluded.invite_code,
         license_file_name = COALESCE(excluded.license_file_name, shop_claim_applications.license_file_name), status = 'pending', review_note = NULL, review_reason = NULL, review_fields = NULL, updated_at = excluded.updated_at`
    ).run(shop.id, req.user.id, relation, inviteCode || null, req.file?.filename || null, now(), now());
    db.prepare("INSERT INTO shop_review_events (shop_id, action, note, created_at) VALUES (?, 'claim_submitted', ?, ?)").run(shop.id, `认领申请：${relation}`, now());
    flash(req, "success", "店铺认领申请已提交，审核通过后才会获得店铺管理权限。 ");
    res.redirect("/merchant/progress");
  });

  app.get("/merchant/onboarding/:id/credentials/:credentialId", requireAuth, (req, res) => {
    const shopId = intId(req.params.id);
    const credentialId = intId(req.params.credentialId);
    const shop = shopId ? getShop(shopId) : null;
    const credential = shop && credentialId ? db.prepare("SELECT * FROM shop_credentials WHERE id = ? AND shop_id = ?").get(credentialId, shop.id) : null;
    if (!shop || !credential || !(userOwnsShop(req.user.id, shop) || req.user.role === "admin")) return renderNotFound(res);
    const file = path.join(privateCredentialDir, path.basename(credential.file_name));
    if (!fs.existsSync(file)) return renderNotFound(res);
    res.sendFile(file);
  });

  app.get("/admin/shop-reviews", requireAdmin, (req, res) => {
    const duplicateShopQuery = db.prepare(
      `SELECT id, name, address, review_status, status
       FROM shops
       WHERE id <> ? AND (name = ? OR (? <> '' AND address = ?))
       ORDER BY updated_at DESC LIMIT 6`
    );
    const shops = db
      .prepare(
        `SELECT s.*, u.username AS applicant_username, u.display_name AS applicant_display_name, u.phone AS applicant_phone
         FROM shops s JOIN users u ON u.id = s.user_id
         WHERE s.business_mode = 'verified_store' AND s.review_status IN ('pending', 'changes_requested', 'rejected', 'suspended')
         ORDER BY CASE s.review_status WHEN 'pending' THEN 0 WHEN 'changes_requested' THEN 1 ELSE 2 END, s.updated_at DESC`
      )
      .all()
      .map((shop) => ({
        ...shop,
        media: getShopMedia(shop.id),
        credentials: getCredentials(shop.id),
        possibleDuplicates: duplicateShopQuery.all(shop.id, shop.name, shop.address || "", shop.address || "")
      }));
    const claims = db
      .prepare(
        `SELECT c.*, s.name AS shop_name, s.address, s.cover_image, u.username AS applicant_username, u.display_name AS applicant_display_name
         FROM shop_claim_applications c
         JOIN shops s ON s.id = c.shop_id JOIN users u ON u.id = c.user_id
         ORDER BY CASE c.status WHEN 'pending' THEN 0 ELSE 1 END, c.updated_at DESC`
      )
      .all();
    res.render("admin-shop-reviews", {
      page: "admin",
      title: "店铺审核与认领",
      shops,
      claims,
      contentReviews: contentReviewQueue(),
      verificationLabel: shopVerificationLabel
    });
  });

  app.get("/admin/shop-credentials/:id", requireAdmin, (req, res) => {
    const id = intId(req.params.id);
    const credential = id ? db.prepare("SELECT * FROM shop_credentials WHERE id = ?").get(id) : null;
    if (!credential) return renderNotFound(res);
    const file = path.join(privateCredentialDir, path.basename(credential.file_name));
    if (!fs.existsSync(file)) return renderNotFound(res);
    res.sendFile(file);
  });

  app.post("/admin/shops/:id/review", requireAdmin, (req, res) => {
    const shopId = intId(req.params.id);
    const shop = shopId ? getShop(shopId) : null;
    if (!shop || !reviewStatuses.has(shop.review_status)) return renderNotFound(res);
    const action = ["approve", "changes", "reject", "suspend"].includes(req.body.action) ? req.body.action : "changes";
    const note = text(req.body.review_note, 500);
    const fields = [...new Set(asArray(req.body.review_fields).map((field) => text(field, 30)).filter(Boolean))];
    if (["changes", "reject"].includes(action) && !note) {
      flash(req, "error", "要求补充资料或拒绝申请时必须填写具体原因。 ");
      return res.redirect("/admin/shop-reviews");
    }
    const status = action === "approve" ? "approved" : action === "changes" ? "changes_requested" : action === "reject" ? "rejected" : "suspended";
    const credentials = getCredentials(shop.id);
    const verified = status === "approved" && shop.business_mode === "verified_store" && credentials.some((credential) => credential.credential_type === "business_license") ? 1 : 0;
    const verificationLabel = status === "approved" && verified ? "platform_verified" : "unverified";
    const transaction = db.transaction(() => {
      db.prepare(
        `UPDATE shops SET review_status = ?, status = ?, verified = ?, verification_label = ?, claimable = CASE WHEN ? = 'approved' THEN 1 ELSE claimable END, review_note = ?, review_reason = ?, review_fields = ?, reviewed_at = ?, reviewed_by = ?, updated_at = ? WHERE id = ?`
      ).run(status, status === "approved" ? "active" : "inactive", verified, verificationLabel, status, note || null, action === "reject" ? note : null, JSON.stringify(fields), now(), req.user.id, now(), shop.id);
      db.prepare("INSERT INTO shop_review_events (shop_id, action, note, fields, reviewer_user_id, created_at) VALUES (?, ?, ?, ?, ?, ?)").run(shop.id, status, note || null, JSON.stringify(fields), req.user.id, now());
      if (status === "approved") {
        ensureStoreOwner(shop.id, shop.user_id);
        db.prepare("UPDATE users SET role = CASE WHEN role = 'admin' THEN 'admin' ELSE 'merchant' END, updated_at = ? WHERE id = ?").run(now(), shop.user_id);
      }
    });
    transaction();
    flash(req, "success", status === "approved" ? "店铺审核通过，商家现在可以上传第一件商品。" : "审核结果已保存并已通知商家。 ");
    res.redirect("/admin/shop-reviews");
  });

  app.post("/admin/shop-claims/:id/review", requireAdmin, (req, res) => {
    const claimId = intId(req.params.id);
    const claim = claimId ? db.prepare("SELECT * FROM shop_claim_applications WHERE id = ?").get(claimId) : null;
    if (!claim) return renderNotFound(res);
    const action = ["approve", "changes", "reject", "suspend"].includes(req.body.action) ? req.body.action : "changes";
    const note = text(req.body.review_note, 500);
    const fields = [...new Set(asArray(req.body.review_fields).map((field) => text(field, 30)).filter(Boolean))];
    if (["changes", "reject"].includes(action) && !note) {
      flash(req, "error", "要求补充资料或拒绝认领时必须填写具体原因。 ");
      return res.redirect("/admin/shop-reviews");
    }
    const existingOwnedShop = ownedShopForUser(claim.user_id);
    if (action === "approve" && existingOwnedShop && existingOwnedShop.id !== claim.shop_id) {
      flash(req, "error", "该申请人已经拥有店铺，不能通过第二个店铺认领申请。");
      return res.redirect("/admin/shop-reviews");
    }
    const status = action === "approve" ? "approved" : action === "changes" ? "changes_requested" : action === "reject" ? "rejected" : "suspended";
    const transaction = db.transaction(() => {
      db.prepare("UPDATE shop_claim_applications SET status = ?, review_note = ?, review_reason = ?, review_fields = ?, reviewed_at = ?, reviewed_by = ?, updated_at = ? WHERE id = ?").run(status, note || null, action === "reject" ? note : null, JSON.stringify(fields), now(), req.user.id, now(), claim.id);
      db.prepare("INSERT INTO shop_review_events (shop_id, claim_application_id, action, note, fields, reviewer_user_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)").run(claim.shop_id, claim.id, `claim_${status}`, note || null, JSON.stringify(fields), req.user.id, now());
      if (status === "approved") {
        ensureStoreOwner(claim.shop_id, claim.user_id);
        if (claim.license_file_name) {
          db.prepare(
            `INSERT INTO shop_credentials (shop_id, credential_type, file_name, original_name, created_at)
             SELECT ?, 'claim_business_license', ?, '认领营业执照', ?
             WHERE NOT EXISTS (SELECT 1 FROM shop_credentials WHERE shop_id = ? AND file_name = ?)`
          ).run(claim.shop_id, claim.license_file_name, now(), claim.shop_id, claim.license_file_name);
        }
        db.prepare("UPDATE users SET role = CASE WHEN role = 'admin' THEN 'admin' ELSE 'merchant' END, updated_at = ? WHERE id = ?").run(now(), claim.user_id);
      }
    });
    transaction();
    flash(req, "success", status === "approved" ? "店铺认领已通过，申请人现在获得店主管理权限。" : "认领审核结果已保存。 ");
    res.redirect("/admin/shop-reviews");
  });

  app.post("/admin/content/:source/:id/review", requireAdmin, (req, res) => {
    const id = intId(req.params.id);
    const sources = {
      product: "products",
      listing: "personal_listings",
      service: "services"
    };
    const table = sources[req.params.source];
    if (!id || !table) return renderNotFound(res);

    const action = ["approve", "reject", "offline"].includes(req.body.action) ? req.body.action : null;
    const reason = text(req.body.review_reason, 500);
    if (!action) return renderNotFound(res);
    if (action === "reject" && !reason) {
      flash(req, "error", "拒绝发布时必须填写具体原因，发布者才能修改后重新提交。");
      return res.redirect("/admin/shop-reviews#content");
    }

    const publicationStatus = action === "approve" ? "published" : action === "reject" ? "rejected" : "offline";
    const legacyStatus = publicationStatus === "published" ? "active" : "inactive";
    const result = db
      .prepare(
        `UPDATE ${table}
         SET publication_status = ?, status = ?, review_reason = ?, reviewed_by = ?, reviewed_at = ?, updated_at = ?
         WHERE id = ?`
      )
      .run(publicationStatus, legacyStatus, action === "approve" ? null : reason || null, req.user.id, now(), now(), id);
    if (!result.changes) return renderNotFound(res);
    flash(req, "success", action === "approve" ? "发布内容已通过审核并公开。" : action === "reject" ? "已拒绝发布并保存具体原因。" : "发布内容已下架。");
    res.redirect("/admin/shop-reviews#content");
  });
}

module.exports = { registerShopOnboarding };
