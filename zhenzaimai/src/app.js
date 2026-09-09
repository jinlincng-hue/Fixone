const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const bcrypt = require("bcryptjs");
const dotenv = require("dotenv");
const express = require("express");
const session = require("express-session");
const multer = require("multer");
const { openDb, rootDir } = require("./db");
const { applyMigrations } = require("./schema");
const { registerShopOnboarding } = require("./shop-onboarding");

dotenv.config();

const app = express();
app.set("trust proxy", 1);
const db = openDb();
applyMigrations(db);

const navItems = [
  { key: "home", label: "首页", href: "/" },
  { key: "products", label: "附近商品", href: "/products" },
  { key: "shops", label: "本地商家", href: "/shops" },
  { key: "secondhand", label: "闲置二手", href: "/secondhand" },
  { key: "services", label: "便民服务", href: "/services" },
  { key: "wanted", label: "全镇求购", href: "/wanted" },
  { key: "map", label: "高桥地图", href: "/map" },
  { key: "merchant", label: "商家入驻", href: "/merchant/apply" },
  { key: "publish", label: "发布商品", href: "/publish" }
];

const uploadTypes = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const MAX_LISTING_IMAGES = 12;
const sessionSecret = process.env.SESSION_SECRET || crypto.randomBytes(48).toString("hex");

if (!process.env.SESSION_SECRET && process.env.NODE_ENV === "production") {
  console.warn("生产环境建议设置 SESSION_SECRET，当前使用临时随机值。");
}

app.set("view engine", "ejs");
app.set("views", path.join(rootDir, "views"));
app.disable("x-powered-by");

// Force HTTPS: plain-HTTP entries drop secure session cookies -> login loop
app.use((req, res, next) => {
  if (req.headers["x-forwarded-proto"] === "http") {
    return res.redirect(301, "https://" + req.headers.host + req.originalUrl);
  }
  next();
});

app.use(express.static(path.join(rootDir, "public"), { maxAge: "7d", etag: true, lastModified: true }));
app.use(express.urlencoded({ extended: false, limit: "1mb" }));
app.use(express.json({ limit: "1mb" }));
app.use(
  session({
    name: "gaoqiao.sid",
    secret: sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 1000 * 60 * 60 * 24 * 7
    }
  })
);

function now() {
  return new Date().toISOString();
}

function text(value, max = 160) {
  return String(value || "").trim().slice(0, max);
}

function intId(value) {
  const id = Number.parseInt(value, 10);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function money(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return Math.round(parsed * 100) / 100;
}

function boolFlag(value) {
  return value === "on" || value === "1" || value === "true" || value === true;
}

function maskPhone(phone) {
  const raw = String(phone || "").trim();
  if (raw.length < 7) return raw || "未填写";
  return `${raw.slice(0, 3)}****${raw.slice(-4)}`;
}

function phoneForPage(phone, user) {
  return user ? String(phone || "未填写") : `${maskPhone(phone)}（登录后查看完整电话）`;
}

function removeFileInside(baseDir, filename) {
  const safeName = path.basename(filename || "");
  if (!safeName) return;
  const target = path.resolve(baseDir, safeName);
  const base = path.resolve(baseDir);
  if (!target.startsWith(base + path.sep)) return;
  try {
    fs.rmSync(target, { force: true });
  } catch (error) {
    console.warn(`无法删除文件 ${target}: ${error.message}`);
  }
}

function removeUploadedPublicFile(publicPath) {
  const value = String(publicPath || "");
  const allowedPrefixes = ["/uploads/products/", "/uploads/listings/"];
  const prefix = allowedPrefixes.find((item) => value.startsWith(item));
  if (!prefix) return;
  removeFileInside(path.join(rootDir, "public", prefix.slice(1)), value.slice(prefix.length));
}

function removeUploadedShopFile(publicPath) {
  const value = String(publicPath || "");
  const prefix = "/uploads/shops/";
  if (!value.startsWith(prefix)) return;
  removeFileInside(path.join(rootDir, "public", "uploads", "shops"), value.slice(prefix.length));
}

function formatDate(value) {
  if (!value) return "";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function statusLabel(status) {
  return (
    {
      draft: "草稿",
      pending: "待审核",
      published: "已发布",
      changes_requested: "待补充资料",
      approved: "已通过",
      rejected: "未通过",
      offline: "已下架",
      suspended: "已暂停",
      active: "上架中",
      inactive: "已下架",
      seeking: "寻找中",
      found: "已找到",
      closed: "已关闭",
      open: "待处理",
      resolved: "已处理"
    }[status] || status
  );
}

function roleLabel(role) {
  return (
    {
      user: "普通村民",
      merchant: "商家",
      admin: "管理员"
    }[role] || role
  );
}

function yuan(value) {
  if (value === null || value === undefined || value === "") return "面议";
  return `¥${Number(value).toFixed(2)}`;
}

function categories() {
  return db.prepare("SELECT * FROM categories ORDER BY sort_order ASC, id ASC").all();
}

function categoryById(id) {
  return db.prepare("SELECT * FROM categories WHERE id = ?").get(id);
}

function categoryBySlug(slug) {
  return db.prepare("SELECT * FROM categories WHERE slug = ?").get(slug);
}

const sensitiveContentTerms = /药品|处方|抗生素|针剂|疫苗|烟草|香烟|爆竹|烟花|管制器具/i;

function hasApprovedBusinessLicense(shopId) {
  const credential = db.prepare("SELECT 1 FROM shop_credentials WHERE shop_id = ? AND credential_type = 'business_license' LIMIT 1").get(shopId);
  if (credential) return true;
  // Compatibility for shops approved through the original merchant_application flow.
  return Boolean(
    db
      .prepare(
        `SELECT 1 FROM shops s JOIN merchant_applications a ON a.id = s.application_id
         WHERE s.id = ? AND a.status = 'approved' AND a.license_image IS NOT NULL AND a.license_image <> '' LIMIT 1`
      )
      .get(shopId)
  );
}

function publicationDecision({ shop, category, name, description }) {
  const flaggedByText = sensitiveContentTerms.test(`${name || ""} ${description || ""}`);
  const needsReview = Boolean(category?.requires_review) || flaggedByText;
  const verifiedStoreReady =
    shop?.business_mode === "verified_store" &&
    shop.review_status === "approved" &&
    shop.status === "active" &&
    shop.verified === 1 &&
    hasApprovedBusinessLicense(shop.id);
  if (verifiedStoreReady && !needsReview) return { publicationStatus: "published", legacyStatus: "active", needsReview: false };
  return { publicationStatus: "pending", legacyStatus: "inactive", needsReview: true };
}

function publicStatusFor(publicationStatus) {
  return publicationStatus === "published" ? "active" : "inactive";
}

function renderNotFound(res) {
  res.status(404).render("message", {
    page: "not-found",
    title: "页面不存在",
    message: "没有找到对应内容，可能已下架或链接有误。"
  });
}

function requireAuth(req, res, next) {
  if (!req.user) {
    return res.redirect(`/auth?next=${encodeURIComponent(req.originalUrl)}`);
  }
  next();
}

function requireMerchant(req, res, next) {
  if (!req.user) return res.redirect(`/auth?role=merchant&next=${encodeURIComponent(req.originalUrl)}`);
  const managesApprovedShop = db
    .prepare(
      `SELECT 1
       FROM shop_members m
       JOIN shops s ON s.id = m.shop_id
       WHERE m.user_id = ? AND m.status = 'active' AND s.status = 'active' AND s.review_status = 'approved'
       LIMIT 1`
    )
    .get(req.user.id);
  if (req.user.role !== "merchant" && !managesApprovedShop) {
    return res.status(403).render("message", {
      page: "forbidden",
      title: "需要商家账号",
      message: "请使用商家账号继续。"
    });
  }
  next();
}

function requireAdmin(req, res, next) {
  if (!req.user) return res.redirect(`/auth?next=${encodeURIComponent(req.originalUrl)}`);
  if (req.user.role !== "admin") {
    return res.status(403).render("message", {
      page: "forbidden",
      title: "需要管理员权限",
      message: "该页面仅管理员可访问。"
    });
  }
  next();
}

function flash(req, type, message) {
  // All operation feedback uses the same short-lived toast behavior.
  req.session.flash = { type, message, autoClose: true };
}

function safeNext(value, fallback = "/") {
  const nextUrl = text(value, 200);
  return nextUrl.startsWith("/") && !nextUrl.startsWith("//") ? nextUrl : fallback;
}

function wechatConfig() {
  const appId = text(process.env.WECHAT_APP_ID, 160);
  const appSecret = text(process.env.WECHAT_APP_SECRET, 240);
  const redirectUri = text(process.env.WECHAT_REDIRECT_URI, 500);
  return {
    appId,
    appSecret,
    redirectUri,
    configured: Boolean(appId && appSecret && redirectUri)
  };
}

function sessionRegenerate(req) {
  return new Promise((resolve, reject) => {
    req.session.regenerate((error) => (error ? reject(error) : resolve()));
  });
}

async function loginWithFreshSession(req, userId, message) {
  await sessionRegenerate(req);
  req.session.userId = userId;
  if (message) flash(req, "success", message);
}

function createWechatUsername(openId) {
  const tail = crypto.createHash("sha256").update(openId).digest("hex").slice(0, 10);
  let candidate = `wx_${tail}`;
  let counter = 1;
  while (db.prepare("SELECT id FROM users WHERE username = ?").get(candidate)) {
    candidate = `wx_${tail}_${counter++}`;
  }
  return candidate;
}

function uploadStorage(destination) {
  fs.mkdirSync(destination, { recursive: true });
  return multer.diskStorage({
    destination,
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname || "").toLowerCase() || ".jpg";
      cb(null, `${Date.now()}-${crypto.randomBytes(8).toString("hex")}${ext}`);
    }
  });
}

function imageUpload(destination) {
  return multer({
    storage: uploadStorage(destination),
    limits: { fileSize: 2 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
      if (!uploadTypes.has(file.mimetype)) {
        return cb(new Error("仅支持 jpg、png、webp、gif 图片，且不超过 2MB"));
      }
      cb(null, true);
    }
  });
}

const uploadProduct = imageUpload(path.join(rootDir, "public", "uploads", "products"));
const uploadListing = imageUpload(path.join(rootDir, "public", "uploads", "listings"));
const uploadProductFiles = uploadProduct.fields([
  { name: "images", maxCount: MAX_LISTING_IMAGES },
  { name: "image", maxCount: 1 }
]);
const uploadListingFiles = uploadListing.fields([
  { name: "images", maxCount: MAX_LISTING_IMAGES },
  { name: "image", maxCount: 1 }
]);
const uploadLicense = imageUpload(path.join(rootDir, "data", "licenses"));
const serviceTypes = [
  "药店送药",
  "家电维修",
  "送水到家",
  "跑腿代办",
  "电动车维修",
  "五金维修",
  "其他服务"
];
const serviceImages = {
  药店送药: "/assets/images/service-pharmacy.svg",
  家电维修: "/assets/images/service-repair.svg",
  送水到家: "/assets/images/service-water.svg",
  跑腿代办: "/assets/images/service-runner.svg",
  电动车维修: "/assets/images/service-ebike.svg",
  五金维修: "/assets/images/tool.svg",
  其他服务: "/assets/images/service-runner.svg"
};

function runUpload(upload, req, res) {
  return new Promise((resolve) => {
    upload(req, res, (err) => {
      if (err) cleanupUploadedFiles(req);
      if (err?.code === "LIMIT_UNEXPECTED_FILE" && err.field === "images") {
        return resolve(new Error(`最多上传${MAX_LISTING_IMAGES}张图片`));
      }
      if (!err && uploadedFiles(req).length > MAX_LISTING_IMAGES) {
        cleanupUploadedFiles(req);
        return resolve(new Error(`最多上传${MAX_LISTING_IMAGES}张图片`));
      }
      resolve(err || null);
    });
  });
}

function uploadedFiles(req) {
  const files = [];
  if (req.file) files.push(req.file);
  if (Array.isArray(req.files)) files.push(...req.files);
  if (req.files && !Array.isArray(req.files)) {
    Object.values(req.files).forEach((fieldFiles) => files.push(...(Array.isArray(fieldFiles) ? fieldFiles : [])));
  }
  return files;
}

function uploadedListingPaths(req) {
  const files = uploadedFiles(req);
  if (files.length > MAX_LISTING_IMAGES) {
    throw new Error(`最多上传${MAX_LISTING_IMAGES}张图片`);
  }
  return files.map((file) => `/uploads/listings/${file.filename}`);
}

function cleanupUploadedFiles(req) {
  uploadedFiles(req).forEach((file) => {
    const destination = path.resolve(file.destination || "");
    const allowedDestinations = [
      path.resolve(rootDir, "public", "uploads", "products"),
      path.resolve(rootDir, "public", "uploads", "listings"),
      path.resolve(rootDir, "data", "licenses")
    ];
    if (allowedDestinations.includes(destination)) removeFileInside(destination, file.filename);
  });
}

function listingImageRows(listingId) {
  return db
    .prepare("SELECT id, listing_id, image_path, sort_order, created_at FROM listing_images WHERE listing_id = ? ORDER BY sort_order ASC, id ASC")
    .all(listingId);
}

function listingImagesFor(listing) {
  if (!listing) return [];
  const rows = listingImageRows(listing.id);
  if (rows.length) return rows;
  return listing.image ? [{ id: null, listing_id: listing.id, image_path: listing.image, sort_order: 0, created_at: listing.created_at }] : [];
}

function decorateListing(listing) {
  if (!listing) return listing;
  const images = listingImagesFor(listing);
  return {
    ...listing,
    images,
    image: images[0]?.image_path || listing.image || "/assets/images/listing-placeholder.svg"
  };
}

function productImageRows(productId) {
  return db
    .prepare("SELECT id, product_id, image_path, sort_order, created_at FROM product_images WHERE product_id = ? ORDER BY sort_order ASC, id ASC")
    .all(productId);
}

function productImagesFor(product) {
  if (!product) return [];
  const rows = productImageRows(product.id);
  if (rows.length) return rows;
  return product.image ? [{ id: null, product_id: product.id, image_path: product.image, sort_order: 0, created_at: product.created_at }] : [];
}

function decorateProduct(product) {
  if (!product) return product;
  const images = productImagesFor(product);
  return {
    ...product,
    images,
    image: images[0]?.image_path || product.image || "/assets/images/product-placeholder.svg"
  };
}

function uploadedProductPaths(req) {
  const files = uploadedFiles(req);
  if (files.length > MAX_LISTING_IMAGES) throw new Error(`最多上传${MAX_LISTING_IMAGES}张图片`);
  return files.map((file) => `/uploads/products/${file.filename}`);
}

function uniqueProductImagePaths(paths) {
  return [...new Set(paths.filter((imagePath) => String(imagePath || "").startsWith("/uploads/products/")))].slice(0, MAX_LISTING_IMAGES);
}

function replaceProductImages(productId, imagePaths) {
  db.prepare("DELETE FROM product_images WHERE product_id = ?").run(productId);
  const insert = db.prepare("INSERT INTO product_images (product_id, image_path, sort_order, created_at) VALUES (?, ?, ?, ?)");
  uniqueProductImagePaths(imagePaths).forEach((imagePath, index) => insert.run(productId, imagePath, index, now()));
}

function commentsFor(targetType, targetId) {
  return db
    .prepare(
      `SELECT c.*, COALESCE(NULLIF(u.display_name, ''), u.username) AS author_name, u.avatar_url
       FROM item_comments c
       JOIN users u ON u.id = c.user_id
       WHERE c.target_type = ? AND c.target_id = ? AND c.status = 'visible'
       ORDER BY c.created_at DESC, c.id DESC
       LIMIT 100`
    )
    .all(targetType, targetId);
}

function deleteMessageThreadsForTarget(targetType, targetId) {
  db.prepare("DELETE FROM message_threads WHERE target_type = ? AND target_id = ?").run(targetType, targetId);
}

function threadForUser(threadId, userId) {
  return db
    .prepare(
      `SELECT t.*,
              COALESCE(NULLIF(b.display_name, ''), b.username) AS buyer_name,
              COALESCE(NULLIF(s.display_name, ''), s.username) AS seller_name
       FROM message_threads t
       JOIN users b ON b.id = t.buyer_user_id
       JOIN users s ON s.id = t.seller_user_id
       WHERE t.id = ? AND (t.buyer_user_id = ? OR t.seller_user_id = ?)
       LIMIT 1`
    )
    .get(threadId, userId, userId);
}

function messageThreadsForUser(userId) {
  return db
    .prepare(
      `SELECT t.*,
              COALESCE(NULLIF(b.display_name, ''), b.username) AS buyer_name,
              COALESCE(NULLIF(s.display_name, ''), s.username) AS seller_name,
              lm.content AS last_message,
              lm.created_at AS last_message_at,
              lm.sender_user_id AS last_sender_user_id
       FROM message_threads t
       JOIN users b ON b.id = t.buyer_user_id
       JOIN users s ON s.id = t.seller_user_id
       LEFT JOIN direct_messages lm ON lm.id = (
         SELECT id FROM direct_messages
         WHERE thread_id = t.id
         ORDER BY created_at DESC, id DESC
         LIMIT 1
       )
       WHERE t.buyer_user_id = ? OR t.seller_user_id = ?
       ORDER BY COALESCE(lm.created_at, t.updated_at) DESC, t.id DESC
       LIMIT 80`
    )
    .all(userId, userId);
}

function sellerProductGroupsForUser(userId) {
  const groups = new Map();
  for (const thread of messageThreadsForUser(userId).filter((item) => item.seller_user_id === userId)) {
    const key = `${thread.target_type}:${thread.target_id}`;
    const existing = groups.get(key);
    if (!existing) {
      groups.set(key, {
        target_type: thread.target_type,
        target_id: thread.target_id,
        title: thread.title,
        image: thread.image,
        customer_count: 1,
        last_message: thread.last_message,
        last_message_at: thread.last_message_at || thread.updated_at,
        updated_at: thread.updated_at
      });
    } else {
      existing.customer_count += 1;
      const latest = String(thread.last_message_at || thread.updated_at || "");
      const current = String(existing.last_message_at || existing.updated_at || "");
      if (latest > current) {
        existing.last_message = thread.last_message;
        existing.last_message_at = thread.last_message_at || thread.updated_at;
        existing.updated_at = thread.updated_at;
      }
    }
  }
  return [...groups.values()].sort((a, b) => String(b.last_message_at || b.updated_at || "").localeCompare(String(a.last_message_at || a.updated_at || "")));
}

function customerThreadsForSellerTarget(userId, targetType, targetId) {
  return messageThreadsForUser(userId).filter((thread) => thread.seller_user_id === userId && thread.target_type === targetType && Number(thread.target_id) === Number(targetId));
}

function directMessagesForThread(threadId) {
  return db
    .prepare(
      `SELECT m.*, COALESCE(NULLIF(u.display_name, ''), u.username) AS sender_name, u.avatar_url
       FROM direct_messages m
       JOIN users u ON u.id = m.sender_user_id
       WHERE m.thread_id = ?
       ORDER BY m.created_at ASC, m.id ASC
       LIMIT 200`
    )
    .all(threadId);
}

function ensureMessageThread({ buyerUserId, sellerUserId, targetType, targetId, title, image }) {
  const timestamp = now();
  db.prepare(
    `INSERT INTO message_threads (buyer_user_id, seller_user_id, target_type, target_id, title, image, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?)
     ON CONFLICT(buyer_user_id, seller_user_id, target_type, target_id)
     DO UPDATE SET title = excluded.title, image = COALESCE(excluded.image, message_threads.image), status = 'active', updated_at = excluded.updated_at`
  ).run(buyerUserId, sellerUserId, targetType, targetId, title, image || null, timestamp, timestamp);
  const thread = db
    .prepare("SELECT * FROM message_threads WHERE buyer_user_id = ? AND seller_user_id = ? AND target_type = ? AND target_id = ?")
    .get(buyerUserId, sellerUserId, targetType, targetId);
  const hasMessages = db.prepare("SELECT 1 FROM direct_messages WHERE thread_id = ? LIMIT 1").get(thread.id);
  if (!hasMessages) {
    db.prepare("INSERT INTO direct_messages (thread_id, sender_user_id, content, created_at) VALUES (?, ?, ?, ?)").run(
      thread.id,
      buyerUserId,
      `我想咨询：${title}`,
      timestamp
    );
  }
  return thread;
}

function existingListingImagePaths(listing) {
  return listingImagesFor(listing).map((image) => image.image_path).filter(Boolean);
}

function uniqueImagePaths(paths) {
  return [...new Set(paths.filter((imagePath) => String(imagePath || "").startsWith("/uploads/listings/")))].slice(0, MAX_LISTING_IMAGES);
}

function replaceListingImages(listingId, imagePaths) {
  db.prepare("DELETE FROM listing_images WHERE listing_id = ?").run(listingId);
  const insert = db.prepare("INSERT INTO listing_images (listing_id, image_path, sort_order, created_at) VALUES (?, ?, ?, ?)");
  uniqueImagePaths(imagePaths).forEach((imagePath, index) => insert.run(listingId, imagePath, index, now()));
}

function managedShopsForUser(userId) {
  return db
    .prepare(
      `SELECT DISTINCT s.*, COALESCE(m.role, CASE WHEN s.user_id = ? THEN 'owner' END) AS member_role
       FROM shops s
       LEFT JOIN shop_members m ON m.shop_id = s.id AND m.user_id = ? AND m.status = 'active'
       WHERE s.status = 'active' AND s.review_status = 'approved' AND (s.user_id = ? OR m.user_id = ?)
       ORDER BY s.updated_at DESC, s.id DESC`
    )
    .all(userId, userId, userId, userId);
}

function currentShopForUser(userId, preferredShopId) {
  const shops = managedShopsForUser(userId);
  const selectedId = intId(preferredShopId);
  return selectedId ? shops.find((shop) => shop.id === selectedId) || null : shops[0] || null;
}

function userManagesShop(userId, shopId) {
  return Boolean(
    db
      .prepare(
        `SELECT 1
         FROM shops s
         LEFT JOIN shop_members m ON m.shop_id = s.id AND m.user_id = ? AND m.status = 'active'
         WHERE s.id = ? AND (s.user_id = ? OR m.user_id = ?)
         LIMIT 1`
      )
      .get(userId, shopId, userId, userId)
  );
}

function shopMemberRole(userId, shopId) {
  const row = db
    .prepare(
      `SELECT CASE WHEN s.user_id = ? THEN 'owner' ELSE m.role END AS role
       FROM shops s
       LEFT JOIN shop_members m ON m.shop_id = s.id AND m.user_id = ? AND m.status = 'active'
       WHERE s.id = ? AND (s.user_id = ? OR m.user_id = ?)
       LIMIT 1`
    )
    .get(userId, userId, shopId, userId, userId);
  return row?.role || null;
}

function userCanManageShopFully(userId, shopId) {
  return ["owner", "admin"].includes(shopMemberRole(userId, shopId));
}

function userCanUpdateProductStatus(userId, productId) {
  const product = db.prepare("SELECT shop_id FROM products WHERE id = ?").get(productId);
  return Boolean(product && shopMemberRole(userId, product.shop_id));
}

function userOwnsListing(userId, listingId) {
  const row = db.prepare("SELECT id FROM personal_listings WHERE id = ? AND user_id = ?").get(listingId, userId);
  return Boolean(row);
}

function userOwnsProduct(userId, productId) {
  const product = db.prepare("SELECT shop_id FROM products WHERE id = ?").get(productId);
  return Boolean(product && userCanManageShopFully(userId, product.shop_id));
}

function userOwnsService(userId, serviceId) {
  const service = db.prepare("SELECT shop_id FROM services WHERE id = ?").get(serviceId);
  return Boolean(service && userCanManageShopFully(userId, service.shop_id));
}

function productQuery(where = "p.status = 'active'", order = "p.updated_at DESC", limit = null) {
  const limitSql = limit ? ` LIMIT ${Number(limit)}` : "";
  return `
    SELECT p.*, c.name AS category_name, c.slug AS category_slug, c.requires_review AS category_requires_review,
           s.name AS shop_name, s.verified AS shop_verified, s.business_mode AS shop_business_mode, s.delivery_area AS shop_delivery_area,
           u.username AS owner_name
    FROM products p
    LEFT JOIN categories c ON c.id = p.category_id
    LEFT JOIN shops s ON s.id = p.shop_id
    LEFT JOIN users u ON u.id = p.user_id
    WHERE ${where}
    ORDER BY ${order}${limitSql}`;
}

function listingQuery(where = "l.status = 'active'", order = "l.updated_at DESC", limit = null) {
  const limitSql = limit ? ` LIMIT ${Number(limit)}` : "";
  return `
    SELECT l.*, c.name AS category_name, c.slug AS category_slug, u.username AS owner_name,
           s.name AS shop_name, s.business_mode AS shop_business_mode, s.verification_label AS shop_verification_label
    FROM personal_listings l
    LEFT JOIN categories c ON c.id = l.category_id
    LEFT JOIN users u ON u.id = l.user_id
    LEFT JOIN shops s ON s.id = l.shop_id
    WHERE ${where}
    ORDER BY ${order}${limitSql}`;
}

function getAccountProfile(userId) {
  return db
    .prepare("SELECT id, username, role, phone, village, display_name, avatar_url, wechat_openid, wechat_unionid, phone_verified_at, is_disabled, created_at, updated_at FROM users WHERE id = ?")
    .get(userId);
}

function getPrimaryManagedShop(userId) {
  return db
    .prepare(
      `SELECT DISTINCT s.* FROM shops s
       LEFT JOIN shop_members m ON m.shop_id = s.id AND m.user_id = ? AND m.status = 'active'
       WHERE s.user_id = ? OR m.user_id = ? ORDER BY s.updated_at DESC LIMIT 1`
    )
    .get(userId, userId, userId);
}

function getOwnedShop(userId) {
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

function ensureStoreOwnerMembership(shopId, userId) {
  const timestamp = now();
  db.prepare(
    `INSERT INTO shop_members (shop_id, user_id, role, status, created_at, updated_at)
     VALUES (?, ?, 'owner', 'active', ?, ?)
     ON CONFLICT(shop_id, user_id) DO UPDATE SET role = 'owner', status = 'active', updated_at = excluded.updated_at`
  ).run(shopId, userId, timestamp, timestamp);
  db.prepare(
    `INSERT INTO store_members (store_id, user_id, role, status, created_at, updated_at)
     VALUES (?, ?, 'owner', 'active', ?, ?)
     ON CONFLICT(store_id, user_id) DO UPDATE SET role = 'owner', status = 'active', updated_at = excluded.updated_at`
  ).run(shopId, userId, timestamp, timestamp);
}

app.use((req, res, next) => {
  if (req.session.userId) {
    const user = db
      .prepare("SELECT id, username, role, phone, village, display_name, avatar_url, wechat_openid, wechat_unionid, phone_verified_at, is_disabled, created_at, updated_at FROM users WHERE id = ?")
      .get(req.session.userId);
    if (!user || user.is_disabled) {
      req.session.destroy(() => {});
    } else {
      req.user = user;
    }
  }

  res.locals.currentUser = req.user || null;
  res.locals.navItems = navItems;
  res.locals.currentArea = "高桥镇";
  res.locals.categories = categories();
  res.locals.serviceTypes = serviceTypes;
  res.locals.flash = req.session.flash || null;
  res.locals.phoneForPage = (phone) => phoneForPage(phone, req.user);
  res.locals.maskPhone = maskPhone;
  res.locals.formatDate = formatDate;
  res.locals.statusLabel = statusLabel;
  res.locals.roleLabel = roleLabel;
  res.locals.yuan = yuan;
  res.locals.wechatConfigured = wechatConfig().configured;
  res.locals.wechatDevLoginEnabled = process.env.NODE_ENV !== "production" && process.env.WECHAT_DEV_LOGIN === "true";
  res.locals.page = "";
  delete req.session.flash;
  next();
});

app.get("/", (req, res) => {
  const nearbyShops = db
    .prepare("SELECT * FROM shops WHERE status = 'active' ORDER BY verified DESC, updated_at DESC LIMIT 3")
    .all();
  const todayProducts = [
    ...db.prepare(productQuery("p.status = 'active'", "p.updated_at DESC", 24)).all(),
    ...db.prepare(
      `SELECT l.*, c.name AS category_name, c.slug AS category_slug, c.requires_review AS category_requires_review,
              s.name AS shop_name, s.verified AS shop_verified, s.business_mode AS shop_business_mode,
              s.delivery_area AS shop_delivery_area, u.username AS owner_name, 'personal_listing' AS source_type
       FROM personal_listings l
       LEFT JOIN categories c ON c.id = l.category_id
       LEFT JOIN shops s ON s.id = l.shop_id
       LEFT JOIN users u ON u.id = l.user_id
       WHERE l.status = 'active' AND l.publication_status = 'published'
       ORDER BY l.updated_at DESC LIMIT 24`
    ).all()
  ].sort((a, b) => String(b.updated_at || "").localeCompare(String(a.updated_at || ""))).slice(0, 24);
  const wantedPosts = db
    .prepare("SELECT w.*, u.username AS owner_name FROM wanted_posts w LEFT JOIN users u ON u.id = w.user_id WHERE w.status = 'seeking' ORDER BY w.created_at DESC LIMIT 4")
    .all();
  const services = db
    .prepare(
      `SELECT sv.*, s.name AS shop_name, s.verified AS shop_verified
       FROM services sv
       LEFT JOIN shops s ON s.id = sv.shop_id
       WHERE sv.status = 'active'
       ORDER BY sv.updated_at DESC LIMIT 6`
    )
    .all();
  res.render("home", {
    page: "home",
    title: "高桥 · 镇在卖",
    nearbyShops,
    todayProducts,
    wantedPosts,
    services
  });
});

app.get("/search", (req, res) => {
  const q = text(req.query.q, 80);
  const pattern = `%${q}%`;
  const params = [pattern, pattern, pattern, pattern];
  const products = q
    ? db
        .prepare(
          productQuery(
            "p.status = 'active' AND (p.name LIKE ? OR p.description LIKE ? OR c.name LIKE ? OR s.name LIKE ?)",
            "p.updated_at DESC",
            30
          )
        )
        .all(...params)
    : [];
  const listings = q
    ? db
        .prepare(
          listingQuery(
            "l.status = 'active' AND (l.name LIKE ? OR l.description LIKE ? OR c.name LIKE ? OR l.village LIKE ?)",
            "l.updated_at DESC",
            30
          )
        )
        .all(...params)
    : [];
  const shops = q
    ? db
        .prepare(
          "SELECT * FROM shops WHERE status = 'active' AND (name LIKE ? OR business_scope LIKE ? OR address LIKE ? OR delivery_area LIKE ?) ORDER BY verified DESC, updated_at DESC LIMIT 20"
        )
        .all(...params)
    : [];
  const services = q
    ? db
        .prepare(
          "SELECT * FROM services WHERE status = 'active' AND (title LIKE ? OR description LIKE ? OR type LIKE ? OR delivery_area LIKE ?) ORDER BY updated_at DESC LIMIT 20"
        )
        .all(...params)
    : [];
  const wanted = q
    ? db
        .prepare(
          "SELECT w.*, u.username AS owner_name FROM wanted_posts w LEFT JOIN users u ON u.id = w.user_id WHERE w.status = 'seeking' AND (w.title LIKE ? OR w.village LIKE ? OR w.budget LIKE ? OR u.username LIKE ?) ORDER BY w.created_at DESC LIMIT 20"
        )
        .all(...params)
    : [];

  res.render("search", {
    page: "products",
    title: `搜索：${q || "全部"}`,
    q,
    products,
    listings,
    shops,
    services,
    wanted
  });
});

app.get("/products", (req, res) => {
  const slug = text(req.query.category, 60);
  const category = slug ? categoryBySlug(slug) : null;
  const products = category
    ? db.prepare(productQuery("p.status = 'active' AND p.category_id = ?", "p.updated_at DESC", 60)).all(category.id)
    : db.prepare(productQuery("p.status = 'active'", "p.updated_at DESC", 60)).all();
  res.render("products", {
    page: "products",
    title: category ? `${category.name}商品` : "附近商品",
    products,
    selectedCategory: category
  });
});

app.get("/products/:id", (req, res) => {
  const id = intId(req.params.id);
  if (!id) return renderNotFound(res);
  const product = decorateProduct(db.prepare(productQuery("p.id = ?", "p.updated_at DESC")).get(id));
  if (!product) return renderNotFound(res);
  const canManage = req.user && (req.user.role === "admin" || userOwnsProduct(req.user.id, id));
  if (product.status !== "active" && !canManage) return renderNotFound(res);
  res.render("product-detail", {
    page: "products",
    title: product.name,
    product,
    canManage,
    comments: commentsFor("product", id)
  });
});

app.get("/contact/product/:id", requireAuth, (req, res) => {
  const id = intId(req.params.id);
  if (!id) return renderNotFound(res);
  const product = decorateProduct(db.prepare(productQuery("p.id = ? AND p.status = 'active'", "p.updated_at DESC")).get(id));
  if (!product || !product.user_id) return renderNotFound(res);
  if (product.user_id === req.user.id) {
    flash(req, "error", "不能联系自己发布的商品。");
    return res.redirect(`/products/${id}`);
  }
  const thread = ensureMessageThread({
    buyerUserId: req.user.id,
    sellerUserId: product.user_id,
    targetType: "product",
    targetId: id,
    title: product.name,
    image: product.image
  });
  res.redirect(`/messages/${thread.id}`);
});

app.get("/categories/:slug", (req, res) => {
  const category = categoryBySlug(text(req.params.slug, 60));
  if (!category) return renderNotFound(res);
  const products = db.prepare(productQuery("p.status = 'active' AND p.category_id = ?", "p.updated_at DESC", 50)).all(category.id);
  const listings = db.prepare(listingQuery("l.status = 'active' AND l.category_id = ?", "l.updated_at DESC", 50)).all(category.id);
  res.render("category", {
    page: "products",
    title: category.name,
    category,
    products,
    listings
  });
});

app.get("/shops", (req, res) => {
  const q = text(req.query.q, 80);
  const mode = ["verified_store", "home_shop"].includes(req.query.mode) ? req.query.mode : "";
  const where = ["status = 'active'", "review_status = 'approved'"];
  const values = [];
  if (mode) {
    where.push("business_mode = ?");
    values.push(mode);
  }
  if (q) {
    where.push("(name LIKE ? OR business_scope LIKE ? OR address LIKE ? OR delivery_area LIKE ? OR village LIKE ?)");
    values.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`);
  }
  const shops = db.prepare(`SELECT * FROM shops WHERE ${where.join(" AND ")} ORDER BY CASE business_mode WHEN 'verified_store' THEN 0 ELSE 1 END, verified DESC, updated_at DESC`).all(...values);
  res.render("shops", {
    page: "shops",
    title: "本地商家",
    shops,
    q,
    mode
  });
});

app.get("/shops/:id", (req, res) => {
  const id = intId(req.params.id);
  if (!id) return renderNotFound(res);
  const shop = db.prepare("SELECT * FROM shops WHERE id = ? AND status = 'active' AND review_status = 'approved'").get(id);
  if (!shop) return renderNotFound(res);
  const products = shop.business_mode === "home_shop"
    ? db.prepare(listingQuery("l.status = 'active' AND l.shop_id = ?", "l.updated_at DESC", 50)).all(id)
    : db.prepare(productQuery("p.status = 'active' AND p.shop_id = ?", "p.updated_at DESC", 50)).all(id);
  const services = db.prepare("SELECT * FROM services WHERE shop_id = ? AND status = 'active' ORDER BY updated_at DESC").all(id);
  const media = db.prepare("SELECT * FROM shop_media WHERE shop_id = ? ORDER BY sort_order ASC, id ASC").all(id);
  res.render("shop-detail", {
    page: "shops",
    title: shop.name,
    shop,
    products,
    services,
    media
  });
});

app.get("/secondhand", (req, res) => {
  const listings = db.prepare(listingQuery("l.status = 'active' AND l.type = 'secondhand'", "l.updated_at DESC", 80)).all();
  res.render("listing-grid", {
    page: "secondhand",
    title: "闲置二手",
    heading: "闲置二手",
    intro: "村里闲置物品，电话联系、自提或配送协商。",
    listings,
    type: "secondhand"
  });
});

app.get("/farm", (req, res) => {
  const listings = db.prepare(listingQuery("l.status = 'active' AND l.type = 'farm'", "l.updated_at DESC", 80)).all();
  res.render("listing-grid", {
    page: "farm",
    title: "本地农产品",
    heading: "本地农产品",
    intro: "自家农货、时令蔬果和乡邻直供。",
    listings,
    type: "farm"
  });
});

app.get("/listings/:id", (req, res) => {
  const id = intId(req.params.id);
  if (!id) return renderNotFound(res);
  const listing = decorateListing(db.prepare(listingQuery("l.id = ?", "l.updated_at DESC")).get(id));
  if (!listing) return renderNotFound(res);
  const canManage = req.user && (req.user.role === "admin" || listing.user_id === req.user.id);
  if (listing.status !== "active" && !canManage) return renderNotFound(res);
  res.render("listing-detail", {
    page: listing.type === "farm" ? "farm" : "secondhand",
    title: listing.name,
    listing,
    canManage,
    comments: commentsFor("listing", id)
  });
});

app.get("/contact/listing/:id", requireAuth, (req, res) => {
  const id = intId(req.params.id);
  if (!id) return renderNotFound(res);
  const listing = decorateListing(db.prepare(listingQuery("l.id = ? AND l.status = 'active' AND l.publication_status = 'published'", "l.updated_at DESC")).get(id));
  if (!listing || !listing.user_id) return renderNotFound(res);
  if (listing.user_id === req.user.id) {
    flash(req, "error", "不能联系自己发布的商品。");
    return res.redirect(`/listings/${id}`);
  }
  const thread = ensureMessageThread({
    buyerUserId: req.user.id,
    sellerUserId: listing.user_id,
    targetType: "listing",
    targetId: id,
    title: listing.name,
    image: listing.image
  });
  res.redirect(`/messages/${thread.id}`);
});

app.get("/services", (req, res) => {
  const services = db
    .prepare(
      `SELECT sv.*, s.name AS shop_name, s.verified AS shop_verified
       FROM services sv
       JOIN shops s ON s.id = sv.shop_id
       WHERE sv.status = 'active' AND s.status = 'active' AND s.verified = 1
       ORDER BY sv.type ASC, sv.updated_at DESC`
    )
    .all();
  res.render("services", {
    page: "services",
    title: "便民服务",
    services
  });
});

app.get("/wanted", (req, res) => {
  const posts = db
    .prepare(
      `SELECT w.*, u.username AS owner_name
       FROM wanted_posts w
       LEFT JOIN users u ON u.id = w.user_id
       ORDER BY CASE w.status WHEN 'seeking' THEN 0 WHEN 'found' THEN 1 ELSE 2 END, w.created_at DESC`
    )
    .all();
  res.render("wanted", {
    page: "wanted",
    title: "全镇求购",
    posts,
    prefill: text(req.query.q, 100)
  });
});

app.get("/map", (req, res) => {
  const shops = db
    .prepare("SELECT id, name, address, phone, business_scope, delivery_area, verified, latitude, longitude FROM shops WHERE status = 'active' AND review_status = 'approved' ORDER BY verified DESC, updated_at DESC")
    .all();
  const markers = [
    {
      type: "town",
      title: "高桥镇中心",
      lat: 28.4638705,
      lng: 113.3307214,
      description: "长沙县高桥镇行政区公开地图点位，来自 OpenStreetMap Nominatim。",
      href: null
    },
    {
      type: "landmark",
      title: "高桥老街",
      lat: 28.461,
      lng: 113.3346,
      description: "高桥镇风貌展示点位，具体位置可后续用实测坐标校准。",
      href: null
    },
    ...shops.map((shop, index) => {
      const coord = Number.isFinite(Number(shop.latitude)) && Number.isFinite(Number(shop.longitude)) ? [Number(shop.latitude), Number(shop.longitude)] : [28.460763 + index * 0.0007, 113.336099 + index * 0.0006];
      return {
        type: "shop",
        title: shop.name,
        lat: coord[0],
        lng: coord[1],
        description: `${shop.business_scope}；${shop.delivery_area}`,
        href: `/shops/${shop.id}`,
        verified: Boolean(shop.verified)
      };
    })
  ];

  res.render("map", {
    page: "map",
    title: "高桥地图",
    mapCenter: { lat: 28.4638705, lng: 113.3307214, zoom: 14 },
    markers
  });
});

app.get("/wanted/new", requireAuth, (req, res) => {
  res.render("publish", {
    page: "publish",
    title: "帮我问全镇",
    mode: "wanted",
    intent: "buy",
    listing: null,
    wantedTitle: text(req.query.q, 120),
    error: null
  });
});

app.post("/wanted", requireAuth, (req, res) => {
  const title = text(req.body.title, 120);
  const budget = text(req.body.budget, 80);
  const village = text(req.body.village, 80) || req.user.village;
  const contactPhone = text(req.body.contact_phone, 40) || req.user.phone;
  if (!title || !village || !contactPhone) {
    return res.status(400).render("publish", {
      page: "publish",
      title: "帮我问全镇",
      mode: "wanted",
      listing: null,
      wantedTitle: title,
      error: "请填写想找的商品或服务、所在村庄和联系电话。"
    });
  }

  db.prepare(
    `INSERT INTO wanted_posts (user_id, title, budget, village, needs_delivery, contact_phone, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'seeking', ?, ?)`
  ).run(req.user.id, title, budget, village, boolFlag(req.body.needs_delivery) ? 1 : 0, contactPhone, now(), now());
  flash(req, "success", "求购信息已发布，商家和村民可以在全镇求购中看到。");
  res.redirect("/wanted");
});

app.post("/wanted/:id/status", requireAuth, (req, res) => {
  const id = intId(req.params.id);
  const status = ["seeking", "found", "closed"].includes(req.body.status) ? req.body.status : null;
  if (!id || !status) return renderNotFound(res);
  const post = db.prepare("SELECT * FROM wanted_posts WHERE id = ?").get(id);
  if (!post) return renderNotFound(res);
  if (req.user.role !== "admin" && post.user_id !== req.user.id) {
    return res.status(403).render("message", { page: "forbidden", title: "无权操作", message: "只能修改自己的求购信息。" });
  }
  db.prepare("UPDATE wanted_posts SET status = ?, updated_at = ? WHERE id = ?").run(status, now(), id);
  flash(req, "success", "求购状态已更新。");
  res.redirect(req.user.role === "admin" ? "/admin/dashboard#wanted" : "/wanted");
});

app.get("/publish", requireAuth, (req, res) => {
  const ownedShop = getOwnedShop(req.user.id);
  if (ownedShop?.business_mode === "home_shop" && ownedShop.status === "active") {
    const intent = ["buy", "wanted"].includes(req.query.mode) ? "buy" : "sell";
    return res.redirect(`/merchant/home-shop/${ownedShop.id}/publish?intent=${intent}`);
  }
  const intent = ["buy", "wanted"].includes(req.query.mode) ? "buy" : "sell";
  res.render("publish", {
    page: "publish",
    title: "发布信息",
    mode: intent,
    intent,
    listing: null,
    wantedTitle: text(req.query.q, 120),
    error: null
  });
});

app.post("/publish", requireAuth, async (req, res) => {
  const ownedShop = getOwnedShop(req.user.id);
  if (ownedShop?.business_mode === "home_shop" && ownedShop.status === "active") {
    const intent = req.body.publish_intent === "buy" ? "buy" : "sell";
    return res.redirect(`/merchant/home-shop/${ownedShop.id}/publish?intent=${intent}`);
  }
  const err = await runUpload(uploadListingFiles, req, res);
  if (err) {
    return res.status(400).render("publish", {
      page: "publish",
      title: "发布信息",
      mode: "sell",
      intent: "sell",
      listing: null,
      wantedTitle: "",
      error: err.message
    });
  }

  const publishIntent = req.body.publish_intent === "buy"
    ? "buy"
    : req.body.publish_intent === "sell"
      ? "sell"
      : null;
  if (publishIntent) {
    let imagePaths;
    try {
      imagePaths = uploadedListingPaths(req);
    } catch (error) {
      cleanupUploadedFiles(req);
      return res.status(400).render("publish", {
        page: "publish",
        title: "发布信息",
        mode: publishIntent,
        intent: publishIntent,
        listing: req.body,
        wantedTitle: publishIntent === "buy" ? text(req.body.name, 120) : "",
        error: error.message
      });
    }

    const name = text(req.body.name, 120);
    const description = text(req.body.description, 1200);
    const rawPrice = text(req.body.price, 40);
    const price = rawPrice ? money(rawPrice) : null;
    if (!name || !description || price === null || price > 999999) {
      cleanupUploadedFiles(req);
      return res.status(400).render("publish", {
        page: "publish",
        title: "发布信息",
        mode: publishIntent,
        intent: publishIntent,
        listing: req.body,
        wantedTitle: publishIntent === "buy" ? name : "",
        error: !rawPrice || price === null || price > 999999 ? "价格需在0.00到999999.00之间。" : "请填写名称和描述。"
      });
    }

    const image = imagePaths[0] || "/assets/images/listing-placeholder.svg";
    const village = text(req.user.village, 80) || "高桥镇";
    const contactPhone = text(req.user.phone, 40) || "平台消息";
    if (publishIntent === "buy") {
      db.prepare(
        `INSERT INTO wanted_posts
         (user_id, title, budget, village, description, image, needs_delivery, contact_phone, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 0, ?, 'seeking', ?, ?)`
      ).run(req.user.id, name, `${price.toFixed(2)} 元以内`, village, description, image, contactPhone, now(), now());
      imagePaths.slice(1).forEach(removeUploadedPublicFile);
      flash(req, "success", "求购信息已发布。");
      return res.redirect("/wanted");
    }

    const category = categoryBySlug("daily") || categories()[0];
    if (!category || sensitiveContentTerms.test(`${name} ${description}`)) {
      cleanupUploadedFiles(req);
      return res.status(400).render("publish", {
        page: "publish",
        title: "发布信息",
        mode: "sell",
        intent: "sell",
        listing: req.body,
        wantedTitle: "",
        error: "当前内容需要人工审核或暂不支持发布，请调整描述后重试。"
      });
    }

    let listingId;
    try {
      db.transaction(() => {
        const created = db.prepare(
          `INSERT INTO personal_listings
           (user_id, category_id, type, listing_type, name, image, price, unit, spec, description, stock_status, condition, village, contact_phone, pickup, delivery, delivery_area, status, publication_status, created_at, updated_at)
           VALUES (?, ?, 'secondhand', 'product', ?, ?, ?, '件', '', ?, '在售', '未填写', ?, ?, 1, 0, '', 'active', 'published', ?, ?)`
        ).run(req.user.id, category.id, name, image, price, description, village, contactPhone, now(), now());
        listingId = Number(created.lastInsertRowid);
        replaceListingImages(listingId, imagePaths);
      })();
    } catch (error) {
      cleanupUploadedFiles(req);
      return res.status(500).render("publish", {
        page: "publish",
        title: "发布信息",
        mode: "sell",
        intent: "sell",
        listing: req.body,
        wantedTitle: "",
        error: "发布失败，请稍后重试。"
      });
    }
    flash(req, "success", "信息已发布。");
    return res.redirect("/secondhand");
  }

  if (req.body.kind === "wanted") {
    cleanupUploadedFiles(req);
    const wantedTitle = text(req.body.wanted_title, 120);
    const budget = text(req.body.budget, 80);
    const village = text(req.body.village, 80) || req.user.village;
    const contactPhone = text(req.body.contact_phone, 40) || req.user.phone;
    if (!wantedTitle || !village || !contactPhone) {
      return res.status(400).render("publish", {
        page: "publish",
        title: "发布信息",
        mode: "wanted",
        intent: "buy",
        listing: null,
        wantedTitle,
        error: "请填写想找的商品或服务、所在村庄和联系电话。"
      });
    }
    db.prepare(
      `INSERT INTO wanted_posts (user_id, title, budget, village, needs_delivery, contact_phone, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'seeking', ?, ?)`
    ).run(req.user.id, wantedTitle, budget, village, boolFlag(req.body.needs_delivery) ? 1 : 0, contactPhone, now(), now());
    flash(req, "success", "求购信息已发布。");
    return res.redirect("/wanted");
  }

  const type = req.body.type === "farm" ? "farm" : "secondhand";
  const listingType = type === "farm" ? "local_produce" : "secondhand";
  const categoryId = intId(req.body.category_id);
  const category = categoryId ? categoryById(categoryId) : null;
  const name = text(req.body.name, 120);
  const price = type === "farm" ? 0 : money(req.body.price);
  const unit = text(req.body.unit, 30) || "件";
  const spec = text(req.body.spec, 120);
  const description = text(req.body.description, 1200);
  const stockStatus = text(req.body.stock_status, 40) || (type === "farm" ? "待审核" : "有货");
  const condition = text(req.body.condition, 40) || (type === "secondhand" ? "八成新" : "自家发布");
  const village = text(req.body.village, 80) || req.user.village;
  const contactPhone = text(req.body.contact_phone, 40) || req.user.phone;
  let imagePaths;
  try {
    imagePaths = uploadedListingPaths(req);
  } catch (error) {
    cleanupUploadedFiles(req);
    return res.status(400).render("publish", {
      page: "publish",
      title: "发布信息",
      mode: "listing",
      intent: "sell",
      listing: req.body,
      wantedTitle: "",
      error: error.message
    });
  }

  if (!name || !category || (type !== "farm" && price === null) || !description || !village || !contactPhone) {
    cleanupUploadedFiles(req);
    return res.status(400).render("publish", {
      page: "publish",
      title: "发布信息",
      mode: "listing",
      intent: "sell",
      listing: req.body,
      wantedTitle: "",
      error: type === "farm" ? "请完整填写名称、分类、描述、村庄和联系电话。" : "请完整填写名称、分类、价格、描述、村庄和联系电话。"
    });
  }
  if (category.slug === "medical") {
    cleanupUploadedFiles(req);
    return res.status(400).render("publish", {
      page: "publish",
      title: "发布信息",
      mode: "listing",
      intent: "sell",
      listing: req.body,
      wantedTitle: "",
      error: "普通用户不能发布药品或医药健康类商品。"
    });
  }

  const image = imagePaths[0] || "/assets/images/listing-placeholder.svg";
  let listingId = null;
  try {
    db.transaction(() => {
      const created = db.prepare(
        `INSERT INTO personal_listings
         (user_id, category_id, type, listing_type, name, image, price, unit, spec, description, stock_status, condition, village, contact_phone, pickup, delivery, delivery_area, status, publication_status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', 'published', ?, ?)`
      ).run(
        req.user.id,
        category.id,
        type,
        listingType,
        name,
        image,
        price,
        unit,
        spec,
        description,
        stockStatus,
        condition,
        village,
        contactPhone,
        boolFlag(req.body.pickup) ? 1 : 0,
        boolFlag(req.body.delivery) ? 1 : 0,
        text(req.body.delivery_area, 160),
        now(),
        now()
      );
      listingId = Number(created.lastInsertRowid);
      replaceListingImages(listingId, imagePaths);
    })();
  } catch (error) {
    cleanupUploadedFiles(req);
    return res.status(500).render("publish", {
      page: "publish",
      title: "发布信息",
      mode: "listing",
      intent: "sell",
      listing: req.body,
      wantedTitle: "",
      error: "发布失败，请稍后重试。"
    });
  }
  flash(req, "success", "信息已发布。");
  res.redirect(type === "farm" ? "/farm" : "/secondhand");
});

app.get("/listings/:id/edit", requireAuth, (req, res) => {
  const id = intId(req.params.id);
  const listing = id ? db.prepare("SELECT * FROM personal_listings WHERE id = ?").get(id) : null;
  if (!listing) return renderNotFound(res);
  if (req.user.role !== "admin" && listing.user_id !== req.user.id) {
    return res.status(403).render("message", { page: "forbidden", title: "无权操作", message: "只能编辑自己的发布。" });
  }
  res.render("listing-edit", {
    page: listing.type === "farm" ? "farm" : "secondhand",
    title: "编辑发布",
    listing: decorateListing(listing),
    existingImages: listingImagesFor(listing),
    error: null
  });
});

app.post("/listings/:id/edit", requireAuth, async (req, res) => {
  const id = intId(req.params.id);
  const listing = id ? db.prepare("SELECT * FROM personal_listings WHERE id = ?").get(id) : null;
  if (!listing) return renderNotFound(res);
  if (req.user.role !== "admin" && listing.user_id !== req.user.id) {
    return res.status(403).render("message", { page: "forbidden", title: "无权操作", message: "只能编辑自己的发布。" });
  }
  const err = await runUpload(uploadListingFiles, req, res);
  if (err) {
    return res.status(400).render("listing-edit", {
      page: "publish",
      title: "编辑发布",
      listing: decorateListing({ ...listing, ...req.body }),
      existingImages: listingImagesFor(listing),
      error: err.message
    });
  }
  const categoryId = intId(req.body.category_id) || intId(listing.category_id);
  const category = categoryId ? categoryById(categoryId) : null;
  const isFarm = listing.type === "farm";
  const rawPrice = text(req.body.price, 40);
  const price = rawPrice ? money(rawPrice) : isFarm ? 0 : null;
  let uploadedPaths;
  try {
    uploadedPaths = uploadedListingPaths(req);
  } catch (error) {
    cleanupUploadedFiles(req);
    return res.status(400).render("listing-edit", {
      page: "publish",
      title: "编辑发布",
      listing: decorateListing({ ...listing, ...req.body }),
      existingImages: listingImagesFor(listing),
      error: error.message
    });
  }
  const oldImagePaths = existingListingImagePaths(listing);
  const hasKeepImages = Object.prototype.hasOwnProperty.call(req.body, "keep_images");
  const keepImageValues = hasKeepImages
    ? (Array.isArray(req.body.keep_images) ? req.body.keep_images : [req.body.keep_images]).map((value) => text(value, 240))
    : oldImagePaths;
  const keepImagePaths = oldImagePaths.filter((imagePath) => keepImageValues.includes(imagePath));
  const finalImagePaths = [...keepImagePaths, ...uploadedPaths];
  if (!text(req.body.name, 120) || !text(req.body.description, 1200) || !category || price === null || price > 999999 || category.slug === "medical" || finalImagePaths.length > MAX_LISTING_IMAGES) {
    cleanupUploadedFiles(req);
    return res.status(400).render("listing-edit", {
      page: "publish",
      title: "编辑发布",
      listing: decorateListing({ ...listing, ...req.body }),
      existingImages: listingImagesFor(listing),
      error: finalImagePaths.length > MAX_LISTING_IMAGES
        ? `最多上传${MAX_LISTING_IMAGES}张图片`
        : price === null || price > 999999
          ? "价格需在0.00到999999.00之间。"
          : "请填写有效内容，普通用户不能发布医药健康类商品。"
    });
  }
  const image = finalImagePaths[0] || "/assets/images/listing-placeholder.svg";
  try {
    db.transaction(() => {
      db.prepare(
        `UPDATE personal_listings
         SET category_id = ?, name = ?, image = ?, price = ?, unit = ?, spec = ?, description = ?, stock_status = ?, condition = ?,
             village = ?, contact_phone = ?, pickup = ?, delivery = ?, delivery_area = ?, updated_at = ?
         WHERE id = ?`
      ).run(
        category.id,
        text(req.body.name, 120),
        image,
        price,
        listing.unit || "件",
        listing.spec || "",
        text(req.body.description, 1200),
        listing.stock_status || "待售",
        listing.condition || "未填写",
        listing.village || "高桥镇",
        listing.contact_phone || "平台消息",
        listing.pickup ? 1 : 0,
        listing.delivery ? 1 : 0,
        listing.delivery_area || "",
        now(),
        id
      );
      replaceListingImages(id, finalImagePaths);
    })();
  } catch (error) {
    cleanupUploadedFiles(req);
    return res.status(500).render("listing-edit", {
      page: "publish",
      title: "编辑发布",
      listing: decorateListing({ ...listing, ...req.body }),
      existingImages: listingImagesFor(listing),
      error: "保存失败，请稍后重试。"
    });
  }
  oldImagePaths.filter((imagePath) => !finalImagePaths.includes(imagePath)).forEach(removeUploadedPublicFile);
  if (listing.shop_id) {
    db.prepare("UPDATE personal_listings SET publication_status = 'pending', status = 'inactive', review_reason = NULL, reviewed_by = NULL, reviewed_at = NULL, updated_at = ? WHERE id = ?").run(now(), id);
  }
  flash(req, "success", "发布信息已更新。");
  res.redirect(`/listings/${id}`);
});

app.post("/listings/:id/status", requireAuth, (req, res) => {
  const id = intId(req.params.id);
  const status = req.body.status === "inactive" ? "inactive" : "active";
  const listing = id ? db.prepare("SELECT * FROM personal_listings WHERE id = ?").get(id) : null;
  if (!listing) return renderNotFound(res);
  if (req.user.role !== "admin" && listing.user_id !== req.user.id) {
    return res.status(403).render("message", { page: "forbidden", title: "无权操作", message: "只能修改自己的发布。" });
  }
  if (status === "active" && listing.shop_id && listing.publication_status !== "published") {
    flash(req, "error", "该乡邻发布尚未通过审核，不能直接上架。请修改后重新提交或等待平台审核。 ");
    return res.redirect(`/listings/${id}`);
  }
  db.prepare("UPDATE personal_listings SET status = ?, updated_at = ? WHERE id = ?").run(status, now(), id);
  flash(req, "success", status === "active" ? "已重新上架。" : "已下架。");
  res.redirect(req.user.role === "admin" ? "/admin/dashboard#listings" : `/listings/${id}`);
});

app.post("/listings/:id/delete", requireAuth, (req, res) => {
  const id = intId(req.params.id);
  const listing = id ? db.prepare("SELECT * FROM personal_listings WHERE id = ?").get(id) : null;
  if (!listing) return renderNotFound(res);
  if (req.user.role !== "admin" && listing.user_id !== req.user.id) {
    return res.status(403).render("message", { page: "forbidden", title: "无权操作", message: "只能删除自己的发布。" });
  }

  const imagePaths = existingListingImagePaths(listing);
  try {
    db.transaction(() => {
      db.prepare("DELETE FROM reports WHERE target_type = 'listing' AND target_id = ?").run(id);
      db.prepare("DELETE FROM item_comments WHERE target_type = 'listing' AND target_id = ?").run(id);
      deleteMessageThreadsForTarget("listing", id);
      db.prepare("DELETE FROM personal_listings WHERE id = ?").run(id);
    })();
  } catch (error) {
    console.error("删除个人发布失败", error);
    return res.status(500).render("message", { page: "account", title: "删除失败", message: "删除失败，请稍后重试。" });
  }
  imagePaths.forEach(removeUploadedPublicFile);
  flash(req, "success", "发布已删除。");
  res.redirect(req.user.role === "admin" ? "/admin/dashboard#listings" : "/account/listings");
});

app.get("/auth", (req, res) => {
  res.render("auth", {
    page: "auth",
    title: "登录注册",
    role: text(req.query.role, 20) || "user",
    nextUrl: text(req.query.next, 200) || "/",
    notice:
      req.query.deleted === "1"
        ? "账号已注销，相关公开内容已删除。"
        : req.query.registered === "1"
          ? "注册成功，请登录。"
          : req.query.switched === "1"
            ? "请使用要切换到的账号登录。"
            : null,
    error: null
  });
});

app.get("/login", (req, res) => {
  const nextUrl = safeNext(req.query.next);
  if (nextUrl.startsWith("/admin")) return res.redirect("/admin/login");
  res.redirect(`/auth?next=${encodeURIComponent(nextUrl)}`);
});

app.get("/admin/login", (req, res) => {
  if (req.user && req.user.role === "admin") return res.redirect("/admin/dashboard");
  res.render("admin-login", {
    page: "auth",
    title: "管理员登录",
    nextUrl: "/admin/dashboard",
    notice: null,
    error: null
  });
});

app.get("/register", (req, res) => {
  res.render("register", {
    page: "auth",
    title: "注册账号",
    nextUrl: text(req.query.next, 200) || "/",
    notice: null,
    error: null
  });
});

app.get("/auth/wechat", (req, res) => {
  const config = wechatConfig();
  if (!config.configured) {
    flash(req, "error", "微信登录暂未配置。可使用旧账号密码登录，或联系平台管理员配置微信开放平台参数。");
    return res.redirect(`/auth?next=${encodeURIComponent(safeNext(req.query.next))}`);
  }
  const state = crypto.randomBytes(24).toString("hex");
  req.session.wechatOAuth = {
    state,
    mode: "login",
    next: safeNext(req.query.next),
    expiresAt: Date.now() + 10 * 60 * 1000
  };
  const query = new URLSearchParams({
    appid: config.appId,
    redirect_uri: config.redirectUri,
    response_type: "code",
    scope: "snsapi_userinfo",
    state
  });
  res.redirect(`https://open.weixin.qq.com/connect/oauth2/authorize?${query.toString()}#wechat_redirect`);
});

app.get("/account/wechat/bind", requireAuth, (req, res) => {
  const config = wechatConfig();
  if (!config.configured) {
    flash(req, "error", "微信绑定暂未配置。请稍后再试。");
    return res.redirect("/account/profile");
  }
  const state = crypto.randomBytes(24).toString("hex");
  req.session.wechatOAuth = {
    state,
    mode: "bind",
    userId: req.user.id,
    next: "/account/profile",
    expiresAt: Date.now() + 10 * 60 * 1000
  };
  const query = new URLSearchParams({
    appid: config.appId,
    redirect_uri: config.redirectUri,
    response_type: "code",
    scope: "snsapi_userinfo",
    state
  });
  res.redirect(`https://open.weixin.qq.com/connect/oauth2/authorize?${query.toString()}#wechat_redirect`);
});

app.get("/auth/wechat/callback", async (req, res, next) => {
  try {
    const config = wechatConfig();
    const flow = req.session.wechatOAuth;
    const incomingState = text(req.query.state, 100);
    const isStateValid = Boolean(
      flow &&
        flow.expiresAt > Date.now() &&
        incomingState &&
        flow.state &&
        incomingState.length === flow.state.length &&
        crypto.timingSafeEqual(Buffer.from(incomingState), Buffer.from(flow.state))
    );
    delete req.session.wechatOAuth;
    if (!config.configured || !isStateValid || !text(req.query.code, 240)) {
      flash(req, "error", "微信授权已失效或配置不完整，请重新发起登录。");
      return res.redirect("/auth");
    }

    const tokenQuery = new URLSearchParams({
      appid: config.appId,
      secret: config.appSecret,
      code: text(req.query.code, 240),
      grant_type: "authorization_code"
    });
    const tokenResponse = await fetch(`https://api.weixin.qq.com/sns/oauth2/access_token?${tokenQuery.toString()}`);
    const tokenPayload = await tokenResponse.json();
    if (!tokenResponse.ok || !tokenPayload.openid || !tokenPayload.access_token) {
      flash(req, "error", "微信授权没有返回可用账号，请稍后重试。");
      return res.redirect("/auth");
    }

    let profilePayload = {};
    try {
      const profileQuery = new URLSearchParams({
        access_token: tokenPayload.access_token,
        openid: tokenPayload.openid,
        lang: "zh_CN"
      });
      const profileResponse = await fetch(`https://api.weixin.qq.com/sns/userinfo?${profileQuery.toString()}`);
      if (profileResponse.ok) profilePayload = await profileResponse.json();
    } catch (error) {
      console.warn(`微信资料读取失败：${error.message}`);
    }

    const openId = text(tokenPayload.openid, 200);
    const unionId = text(tokenPayload.unionid || profilePayload.unionid, 200) || null;
    const displayName = text(profilePayload.nickname, 80) || "微信用户";
    const avatarUrl = text(profilePayload.headimgurl, 500) || null;

    if (flow.mode === "bind") {
      const current = db.prepare("SELECT id FROM users WHERE id = ? AND is_disabled = 0").get(flow.userId);
      const occupied = db.prepare("SELECT id FROM users WHERE wechat_openid = ?").get(openId);
      if (!current) {
        flash(req, "error", "当前账号已失效，请重新登录后再绑定微信。");
        return res.redirect("/auth");
      }
      if (occupied && occupied.id !== current.id) {
        flash(req, "error", "该微信已绑定其他账号，不能重复关联。系统不会按昵称自动合并账号。");
        return res.redirect("/account/profile");
      }
      db.prepare(
        "UPDATE users SET wechat_openid = ?, wechat_unionid = ?, display_name = COALESCE(NULLIF(display_name, ''), ?), avatar_url = COALESCE(?, avatar_url), updated_at = ? WHERE id = ?"
      ).run(openId, unionId, displayName, avatarUrl, now(), current.id);
      await loginWithFreshSession(req, current.id, "微信已绑定，以后可以优先使用当前微信登录。");
      return res.redirect("/account/profile");
    }

    let user = db.prepare("SELECT * FROM users WHERE wechat_openid = ?").get(openId);
    if (!user) {
      const userId = db
        .prepare(
          `INSERT INTO users
           (username, password_hash, role, phone, village, is_disabled, wechat_openid, wechat_unionid, display_name, avatar_url, created_at, updated_at)
           VALUES (?, ?, 'user', '', '高桥镇', 0, ?, ?, ?, ?, ?, ?)`
        )
        .run(createWechatUsername(openId), bcrypt.hashSync(crypto.randomBytes(32).toString("hex"), 12), openId, unionId, displayName, avatarUrl, now(), now());
      user = { id: userId.lastInsertRowid };
    } else {
      db.prepare("UPDATE users SET wechat_unionid = COALESCE(?, wechat_unionid), avatar_url = COALESCE(?, avatar_url), updated_at = ? WHERE id = ?").run(
        unionId,
        avatarUrl,
        now(),
        user.id
      );
    }
    await loginWithFreshSession(req, user.id, "微信登录成功。手机号可在账号中心自愿绑定；未绑定时请使用当前微信登录。");
    res.redirect(safeNext(flow.next));
  } catch (error) {
    next(error);
  }
});

app.post("/auth/wechat/dev", async (req, res, next) => {
  try {
    if (process.env.NODE_ENV === "production" || process.env.WECHAT_DEV_LOGIN !== "true") return renderNotFound(res);
    const openId = `dev_${text(req.body.openid, 80) || "wechat_user"}`;
    let user = db.prepare("SELECT id FROM users WHERE wechat_openid = ?").get(openId);
    if (!user) {
      const result = db
        .prepare(
          `INSERT INTO users
           (username, password_hash, role, phone, village, is_disabled, wechat_openid, display_name, created_at, updated_at)
           VALUES (?, ?, 'user', '', '高桥镇', 0, ?, ?, ?, ?)`
        )
        .run(createWechatUsername(openId), bcrypt.hashSync(crypto.randomBytes(32).toString("hex"), 12), openId, "本地微信测试用户", now(), now());
      user = { id: result.lastInsertRowid };
    }
    await loginWithFreshSession(req, user.id, "已使用本地微信测试账号登录。");
    res.redirect(safeNext(req.body.next, "/merchant/apply"));
  } catch (error) {
    next(error);
  }
});

app.post("/register", async (req, res, next) => {
  const username = text(req.body.username, 60);
  const phone = text(req.body.phone, 40);
  const village = text(req.body.village, 80);
  const role = req.body.role === "merchant" ? "merchant" : "user";
  const password = String(req.body.password || "");
  if (username.length < 2 || !village || password.length < 8) {
    return res.status(400).render("register", {
      page: "auth",
      title: "注册账号",
      nextUrl: text(req.body.next, 200) || "/",
      notice: null,
      error: "请填写至少 2 个字的用户名、所在村庄，并使用至少 8 位密码。手机号可稍后自愿绑定。"
    });
  }
  const exists = db.prepare("SELECT id FROM users WHERE username = ?").get(username);
  if (exists) {
    return res.status(400).render("register", {
      page: "auth",
      title: "注册账号",
      nextUrl: text(req.body.next, 200) || "/",
      notice: null,
      error: "用户名已存在，请换一个。"
    });
  }
  const passwordHash = bcrypt.hashSync(password, 12);
  const result = db
    .prepare("INSERT INTO users (username, password_hash, role, phone, village, is_disabled, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 0, ?, ?)")
    .run(username, passwordHash, role, phone, village, now(), now());
  try {
    const nextUrl = safeNext(req.body.next);
    res.redirect(`/auth?registered=1&next=${encodeURIComponent(nextUrl)}`);
  } catch (error) {
    next(error);
  }
});

app.post("/login", async (req, res, next) => {
  const username = text(req.body.username, 60);
  const password = String(req.body.password || "");
  const requestedNextUrl = safeNext(req.body.next);
  const isAdminLogin = requestedNextUrl.startsWith("/admin");
  const user = db.prepare("SELECT * FROM users WHERE username = ?").get(username);
  if (!user || !bcrypt.compareSync(password, user.password_hash) || user.is_disabled) {
    if (isAdminLogin) {
      return res.status(401).render("admin-login", {
        page: "auth",
        title: "管理员登录",
        nextUrl: requestedNextUrl,
        notice: null,
        error: "管理员账号或密码不正确，或账号已被禁用。"
      });
    }
    return res.status(401).render("auth", {
      page: "auth",
      title: "登录注册",
      role: "user",
      showRegister: false,
      nextUrl: text(req.body.next, 200) || "/",
      notice: null,
      error: "用户名或密码不正确，或账号已被禁用。"
    });
  }
  if (isAdminLogin && user.role !== "admin") {
    return res.status(403).render("admin-login", {
      page: "auth",
      title: "管理员登录",
      nextUrl: requestedNextUrl,
      notice: null,
      error: "该账号不是管理员账号，不能进入后台。"
    });
  }
  try {
    await loginWithFreshSession(req, user.id, "已登录。");
    const nextUrl = text(req.body.next, 200);
    if (nextUrl && nextUrl.startsWith("/")) return res.redirect(nextUrl);
    if (user.role === "admin") return res.redirect("/admin/dashboard");
    if (user.role === "merchant") return res.redirect("/merchant/dashboard");
    res.redirect("/");
  } catch (error) {
    next(error);
  }
});

app.post("/logout", requireAuth, (req, res) => {
  req.session.destroy(() => res.redirect("/"));
});

app.post("/account/switch", requireAuth, (req, res) => {
  req.session.destroy(() => res.redirect("/auth?switched=1&next=%2Faccount"));
});

function renderMessagesPage(req, res, activeThreadId = null, activeTarget = null) {
  const shopUpdates = db
    .prepare(
      `SELECT DISTINCT s.name, s.review_status, s.review_note, s.updated_at
       FROM shops s
       LEFT JOIN shop_members m ON m.shop_id = s.id AND m.user_id = ? AND m.status = 'active'
       WHERE s.user_id = ? OR m.user_id = ?
       ORDER BY s.updated_at DESC
       LIMIT 20`
    )
    .all(req.user.id, req.user.id, req.user.id);
  const wantedUpdates = db
    .prepare("SELECT title, status, updated_at FROM wanted_posts WHERE user_id = ? ORDER BY updated_at DESC LIMIT 20")
    .all(req.user.id);
  const threads = messageThreadsForUser(req.user.id);
  const productGroups = sellerProductGroupsForUser(req.user.id);
  const buyerThreads = threads.filter((thread) => thread.buyer_user_id === req.user.id);
  const targetForCustomers = activeTarget || (activeThreadId ? threadForUser(activeThreadId, req.user.id) : null);
  const customerThreads =
    activeTarget
      ? customerThreadsForSellerTarget(req.user.id, activeTarget.target_type, activeTarget.target_id)
      : targetForCustomers && targetForCustomers.seller_user_id === req.user.id
      ? customerThreadsForSellerTarget(req.user.id, targetForCustomers.target_type, targetForCustomers.target_id)
      : [];
  const selectedThread = activeThreadId ? threadForUser(activeThreadId, req.user.id) : null;
  const threadMessages = selectedThread ? directMessagesForThread(selectedThread.id) : [];

  res.render("messages", {
    page: "messages",
    title: "消息",
    shopUpdates,
    wantedUpdates,
    threads,
    productGroups,
    buyerThreads,
    customerThreads,
    activeTarget: activeTarget || null,
    selectedThread,
    threadMessages
  });
}

app.get("/messages", requireAuth, (req, res) => {
  renderMessagesPage(req, res);
});

app.get("/messages/item/:targetType/:targetId", requireAuth, (req, res) => {
  const targetType = ["product", "listing"].includes(req.params.targetType) ? req.params.targetType : null;
  const targetId = intId(req.params.targetId);
  if (!targetType || !targetId) return renderNotFound(res);
  const group = sellerProductGroupsForUser(req.user.id).find((item) => item.target_type === targetType && Number(item.target_id) === targetId);
  if (!group) return renderNotFound(res);
  renderMessagesPage(req, res, null, group);
});

app.get("/messages/:id", requireAuth, (req, res) => {
  const id = intId(req.params.id);
  if (!id || !threadForUser(id, req.user.id)) return renderNotFound(res);
  renderMessagesPage(req, res, id);
});

app.post("/messages/:id", requireAuth, (req, res) => {
  const id = intId(req.params.id);
  const thread = id ? threadForUser(id, req.user.id) : null;
  if (!thread) return renderNotFound(res);
  const content = text(req.body.content, 600);
  if (!content) {
    flash(req, "error", "消息不能为空。");
    return res.redirect(`/messages/${id}`);
  }
  const timestamp = now();
  db.transaction(() => {
    db.prepare("INSERT INTO direct_messages (thread_id, sender_user_id, content, created_at) VALUES (?, ?, ?, ?)").run(id, req.user.id, content, timestamp);
    db.prepare("UPDATE message_threads SET updated_at = ? WHERE id = ?").run(timestamp, id);
  })();
  res.redirect(`/messages/${id}`);
});

app.get("/account", requireAuth, (req, res) => {
  const profile = getAccountProfile(req.user.id);
  const listingStats = db
    .prepare(
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS active,
         SUM(CASE WHEN status = 'inactive' THEN 1 ELSE 0 END) AS inactive
       FROM personal_listings WHERE user_id = ?`
    )
    .get(req.user.id);
  const wantedStats = db
    .prepare(
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN status = 'seeking' THEN 1 ELSE 0 END) AS seeking,
         SUM(CASE WHEN status = 'found' THEN 1 ELSE 0 END) AS found,
         SUM(CASE WHEN status = 'closed' THEN 1 ELSE 0 END) AS closed
       FROM wanted_posts WHERE user_id = ?`
    )
    .get(req.user.id);
  const application = db.prepare("SELECT * FROM merchant_applications WHERE user_id = ? ORDER BY id DESC LIMIT 1").get(req.user.id);
  const shop = getPrimaryManagedShop(req.user.id);
  const ownedShop = getOwnedShop(req.user.id);
  const adminStats =
    req.user.role === "admin"
      ? {
          pendingApplications: db.prepare("SELECT COUNT(*) AS count FROM merchant_applications WHERE status = 'pending'").get().count,
          openReports: db.prepare("SELECT COUNT(*) AS count FROM reports WHERE status = 'open'").get().count,
          activeProducts: db.prepare("SELECT COUNT(*) AS count FROM products WHERE status = 'active'").get().count,
          users: db.prepare("SELECT COUNT(*) AS count FROM users").get().count
        }
      : null;

  res.render("account", {
    page: "account",
    title: "我的账号",
    profile,
    listingStats,
    wantedStats,
    application,
    shop,
    ownedShop,
    adminStats
  });
});

app.get("/account/profile", requireAuth, (req, res) => {
  res.render("account-profile", {
    page: "account",
    title: "账号资料",
    profile: getAccountProfile(req.user.id)
  });
});

app.get("/account/security", requireAuth, (req, res) => {
  res.render("account-security", {
    page: "account",
    title: "账号与安全",
    profile: getAccountProfile(req.user.id)
  });
});

app.get("/account/security/password", requireAuth, (req, res) => {
  res.render("account-password", {
    page: "account",
    title: "修改密码"
  });
});

app.get("/account/security/delete", requireAuth, (req, res) => {
  res.render("account-delete", {
    page: "account",
    title: "注销账号",
    profile: getAccountProfile(req.user.id)
  });
});

app.get("/account/settings", requireAuth, (req, res) => {
  res.render("account-settings", {
    page: "account",
    title: "设置",
    profile: getAccountProfile(req.user.id)
  });
});

app.get("/account/listings", requireAuth, (req, res) => {
  const listings = db.prepare(listingQuery("l.user_id = ?", "l.updated_at DESC", 100)).all(req.user.id);
  res.render("account-listings", {
    page: "account",
    title: "我发布的",
    listings
  });
});

app.get("/account/wanted", requireAuth, (req, res) => {
  const wantedPosts = db
    .prepare("SELECT w.*, u.username AS owner_name FROM wanted_posts w LEFT JOIN users u ON u.id = w.user_id WHERE w.user_id = ? ORDER BY w.updated_at DESC LIMIT 100")
    .all(req.user.id);
  res.render("account-wanted", {
    page: "account",
    title: "我的求购",
    wantedPosts
  });
});

app.get("/account/shops", requireAuth, (req, res) => {
  const shops = db
    .prepare(
      `SELECT DISTINCT s.*, COALESCE(m.role, CASE WHEN s.user_id = ? THEN 'owner' END) AS member_role
       FROM shops s
       LEFT JOIN shop_members m ON m.shop_id = s.id AND m.user_id = ? AND m.status = 'active'
       WHERE s.user_id = ? OR m.user_id = ?
       ORDER BY s.updated_at DESC, s.id DESC`
    )
    .all(req.user.id, req.user.id, req.user.id, req.user.id);
  res.render("account-shops", {
    page: "account",
    title: "我的店铺",
    shops,
    ownsShop: Boolean(getOwnedShop(req.user.id))
  });
});

function getOwnedShopForDeletion(userId, shopId) {
  const shop = db.prepare("SELECT * FROM shops WHERE id = ?").get(shopId);
  if (!shop || shopMemberRole(userId, shopId) !== "owner") return null;
  return shop;
}

app.get("/account/shops/:id/delete", requireAuth, (req, res) => {
  const shopId = intId(req.params.id);
  const shop = shopId ? getOwnedShopForDeletion(req.user.id, shopId) : null;
  if (!shop) return renderNotFound(res);
  res.render("shop-delete", {
    page: "account",
    title: "关闭并删除店铺",
    shop,
    error: null
  });
});

app.post("/account/shops/:id/delete", requireAuth, (req, res) => {
  const shopId = intId(req.params.id);
  const shop = shopId ? getOwnedShopForDeletion(req.user.id, shopId) : null;
  if (!shop) return renderNotFound(res);

  const confirmText = text(req.body.confirm_text, 20);
  if (confirmText !== "删除店铺") {
    return res.status(400).render("shop-delete", {
      page: "account",
      title: "关闭并删除店铺",
      shop,
      error: "请输入“删除店铺”确认本次操作。"
    });
  }

  const products = db.prepare("SELECT id, image FROM products WHERE shop_id = ?").all(shop.id);
  const listings = db.prepare("SELECT id, image FROM personal_listings WHERE shop_id = ?").all(shop.id);
  const listingImagePaths = new Map(
    listings.map((listing) => [listing.id, listingImagesFor(listing).map((image) => image.image_path)])
  );
  const services = db.prepare("SELECT id, image FROM services WHERE shop_id = ?").all(shop.id);
  const media = db.prepare("SELECT file_path FROM shop_media WHERE shop_id = ?").all(shop.id);
  const credentials = db.prepare("SELECT file_name FROM shop_credentials WHERE shop_id = ?").all(shop.id);
  const claimCredentials = db.prepare("SELECT license_file_name FROM shop_claim_applications WHERE shop_id = ? AND license_file_name IS NOT NULL").all(shop.id);
  const oldApplication = shop.application_id
    ? db.prepare("SELECT license_image FROM merchant_applications WHERE id = ?").get(shop.application_id)
    : null;

  const deleteReportsForTargets = (targetType, ids) => {
    if (!ids.length) return;
    db.prepare(`DELETE FROM reports WHERE target_type = ? AND target_id IN (${ids.map(() => "?").join(",")})`).run(targetType, ...ids);
  };

  const transaction = db.transaction(() => {
    deleteReportsForTargets("shop", [shop.id]);
    deleteReportsForTargets("product", products.map((product) => product.id));
    deleteReportsForTargets("listing", listings.map((listing) => listing.id));
    deleteReportsForTargets("service", services.map((service) => service.id));
    products.forEach((product) => db.prepare("DELETE FROM item_comments WHERE target_type = 'product' AND target_id = ?").run(product.id));
    listings.forEach((listing) => db.prepare("DELETE FROM item_comments WHERE target_type = 'listing' AND target_id = ?").run(listing.id));
    products.forEach((product) => deleteMessageThreadsForTarget("product", product.id));
    listings.forEach((listing) => deleteMessageThreadsForTarget("listing", listing.id));
    db.prepare("DELETE FROM products WHERE shop_id = ?").run(shop.id);
    db.prepare("DELETE FROM personal_listings WHERE shop_id = ?").run(shop.id);
    db.prepare("DELETE FROM services WHERE shop_id = ?").run(shop.id);
    const result = db.prepare("DELETE FROM shops WHERE id = ?").run(shop.id);
    if (result.changes !== 1) throw new Error("店铺删除失败，请稍后重试。 ");
  });

  try {
    transaction();
  } catch (error) {
    console.error(error);
    return res.status(500).render("shop-delete", {
      page: "account",
      title: "关闭并删除店铺",
      shop,
      error: "店铺删除失败，原数据未改变，请稍后重试。"
    });
  }

  for (const product of products) removeUploadedPublicFile(product.image);
  for (const listing of listings) {
    const imagePaths = listingImagePaths.get(listing.id) || [listing.image];
    for (const imagePath of imagePaths) removeUploadedPublicFile(imagePath);
  }
  for (const service of services) removeUploadedPublicFile(service.image);
  for (const item of media) removeUploadedShopFile(item.file_path);
  removeUploadedShopFile(shop.cover_image);
  removeUploadedShopFile(shop.logo_image);
  for (const credential of credentials) removeFileInside(path.join(rootDir, "data", "licenses"), credential.file_name);
  for (const credential of claimCredentials) removeFileInside(path.join(rootDir, "data", "licenses"), credential.license_file_name);
  if (oldApplication) removeFileInside(path.join(rootDir, "data", "licenses"), oldApplication.license_image);

  flash(req, "success", "店铺已删除，店铺商品和服务也已一并移除。 ");
  res.redirect("/account/shops");
});

app.post("/account/profile", requireAuth, (req, res) => {
  const username = text(req.body.username, 60);
  const phone = text(req.body.phone, 40);
  const village = text(req.body.village, 80);
  if (username.length < 2 || !village) {
    flash(req, "error", "请填写至少 2 个字的用户名和所在村庄。手机号可自愿绑定。");
    return res.redirect("/account/profile");
  }
  const exists = db.prepare("SELECT id FROM users WHERE username = ? AND id <> ?").get(username, req.user.id);
  if (exists) {
    flash(req, "error", "用户名已被使用，请换一个。");
    return res.redirect("/account/profile");
  }
  db.prepare("UPDATE users SET username = ?, phone = ?, village = ?, updated_at = ? WHERE id = ?").run(username, phone, village, now(), req.user.id);
  flash(req, "success", "账号资料已更新。");
  res.redirect("/account/profile");
});

app.post("/account/password", requireAuth, (req, res) => {
  const currentPassword = String(req.body.current_password || "");
  const newPassword = String(req.body.new_password || "");
  const confirmPassword = String(req.body.confirm_password || "");
  const user = db.prepare("SELECT password_hash FROM users WHERE id = ?").get(req.user.id);
  if (!user || !bcrypt.compareSync(currentPassword, user.password_hash)) {
    flash(req, "error", "当前密码不正确。");
    return res.redirect("/account/security/password");
  }
  if (newPassword.length < 8 || newPassword !== confirmPassword) {
    flash(req, "error", "新密码至少 8 位，并且两次输入需要一致。");
    return res.redirect("/account/security/password");
  }
  db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(bcrypt.hashSync(newPassword, 12), req.user.id);
  flash(req, "success", "密码已更新，请妥善保管新密码。");
  res.redirect("/account/security/password");
});

app.post("/account/delete", requireAuth, (req, res) => {
  const password = String(req.body.password || "");
  const confirmText = text(req.body.confirm_text, 20);
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(req.user.id);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    flash(req, "error", "当前密码不正确，账号未注销。");
    return res.redirect("/account/security/delete#danger");
  }
  if (confirmText !== "注销账号") {
    flash(req, "error", "请输入“注销账号”确认本次操作。");
    return res.redirect("/account/security/delete#danger");
  }
  if (user.role === "admin") {
    const adminCount = db.prepare("SELECT COUNT(*) AS count FROM users WHERE role = 'admin' AND is_disabled = 0").get().count;
    if (adminCount <= 1) {
      flash(req, "error", "当前是最后一个可用管理员账号，不能注销。");
      return res.redirect("/account/security/delete#danger");
    }
  }

  const products = db.prepare("SELECT id, image FROM products WHERE user_id = ?").all(user.id);
  const listings = db.prepare("SELECT id, image FROM personal_listings WHERE user_id = ?").all(user.id);
  const listingImagePaths = new Map(
    listings.map((listing) => [listing.id, listingImagesFor(listing).map((image) => image.image_path)])
  );
  const wanted = db.prepare("SELECT id FROM wanted_posts WHERE user_id = ?").all(user.id);
  const shops = db.prepare("SELECT id FROM shops WHERE user_id = ?").all(user.id);
  const applications = db.prepare("SELECT license_image FROM merchant_applications WHERE user_id = ?").all(user.id);
  const shopIds = shops.map((shop) => shop.id);
  const serviceRows = shopIds.length
    ? db.prepare(`SELECT id FROM services WHERE shop_id IN (${shopIds.map(() => "?").join(",")})`).all(...shopIds)
    : [];

  const deleteReportsForTargets = (targetType, ids) => {
    if (!ids.length) return;
    db.prepare(`DELETE FROM reports WHERE target_type = ? AND target_id IN (${ids.map(() => "?").join(",")})`).run(targetType, ...ids);
  };

  const tx = db.transaction(() => {
    deleteReportsForTargets("product", products.map((product) => product.id));
    deleteReportsForTargets("listing", listings.map((listing) => listing.id));
    deleteReportsForTargets("wanted", wanted.map((post) => post.id));
    deleteReportsForTargets("shop", shopIds);
    deleteReportsForTargets("service", serviceRows.map((service) => service.id));
    if (serviceRows.length) {
      db.prepare(`DELETE FROM services WHERE id IN (${serviceRows.map(() => "?").join(",")})`).run(...serviceRows.map((service) => service.id));
    }
    db.prepare("DELETE FROM users WHERE id = ?").run(user.id);
  });
  tx();

  for (const product of products) removeUploadedPublicFile(product.image);
  for (const listing of listings) {
    const imagePaths = listingImagePaths.get(listing.id) || [listing.image];
    for (const imagePath of imagePaths) removeUploadedPublicFile(imagePath);
  }
  for (const application of applications) removeFileInside(path.join(rootDir, "data", "licenses"), application.license_image);

  req.session.destroy(() => {
    res.redirect("/auth?deleted=1");
  });
});

app.get("/merchant/legacy-apply", requireMerchant, (req, res) => {
  if (getOwnedShop(req.user.id)) {
    flash(req, "error", "一个账号只能创建一个店铺，请在我的店铺继续管理。");
    return res.redirect("/account/shops");
  }
  const application = db
    .prepare("SELECT * FROM merchant_applications WHERE user_id = ? ORDER BY id DESC LIMIT 1")
    .get(req.user.id);
  res.render("merchant-apply", {
    page: "merchant",
    title: "商家入驻",
    application,
    error: null
  });
});

app.post("/merchant/legacy-apply", requireMerchant, async (req, res) => {
  if (getOwnedShop(req.user.id)) {
    flash(req, "error", "一个账号只能创建一个店铺，请在我的店铺继续管理。");
    return res.redirect("/account/shops");
  }
  const err = await runUpload(uploadLicense.single("license"), req, res);
  const existing = db.prepare("SELECT * FROM merchant_applications WHERE user_id = ? ORDER BY id DESC LIMIT 1").get(req.user.id);
  if (err) {
    return res.status(400).render("merchant-apply", { page: "merchant", title: "商家入驻", application: existing, error: err.message });
  }
  const shopName = text(req.body.shop_name, 120);
  const creditCode = text(req.body.credit_code, 60);
  const phone = text(req.body.phone, 40);
  const address = text(req.body.address, 180);
  if (!shopName || !creditCode || !phone || !address || (!req.file && !existing)) {
    return res.status(400).render("merchant-apply", {
      page: "merchant",
      title: "商家入驻",
      application: existing,
      error: "请填写店铺名称、统一社会信用代码、地址、电话，并上传营业执照。"
    });
  }
  const license = req.file ? req.file.filename : existing.license_image;
  if (existing) {
    db.prepare(
      `UPDATE merchant_applications
       SET credit_code = ?, shop_name = ?, address = ?, phone = ?, business_hours = ?, business_scope = ?, delivery_area = ?,
           license_image = ?, status = 'pending', rejection_reason = NULL, review_note = NULL, updated_at = ?
       WHERE id = ? AND user_id = ?`
    ).run(
      creditCode,
      shopName,
      address,
      phone,
      text(req.body.business_hours, 120),
      text(req.body.business_scope, 240),
      text(req.body.delivery_area, 240),
      license,
      now(),
      existing.id,
      req.user.id
    );
  } else {
    db.prepare(
      `INSERT INTO merchant_applications
       (user_id, credit_code, shop_name, address, phone, business_hours, business_scope, delivery_area, license_image, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`
    ).run(
      req.user.id,
      creditCode,
      shopName,
      address,
      phone,
      text(req.body.business_hours, 120),
      text(req.body.business_scope, 240),
      text(req.body.delivery_area, 240),
      license,
      now(),
      now()
    );
  }
  flash(req, "success", "入驻申请已提交，等待管理员人工审核。");
  res.redirect("/merchant/apply");
});

app.get("/merchant/dashboard", requireMerchant, (req, res) => {
  const application = db
    .prepare("SELECT * FROM merchant_applications WHERE user_id = ? ORDER BY id DESC LIMIT 1")
    .get(req.user.id);
  const managedShops = managedShopsForUser(req.user.id);
  const shop = currentShopForUser(req.user.id, req.query.shop);
  const canManageShop = Boolean(shop && userCanManageShopFully(req.user.id, shop.id));
  const products = shop
    ? db.prepare(productQuery("p.shop_id = ?", "p.updated_at DESC", 100)).all(shop.id)
    : [];
  const homeListings = shop && shop.business_mode === "home_shop"
    ? db.prepare(listingQuery("l.shop_id = ?", "l.updated_at DESC", 100)).all(shop.id)
    : [];
  const services = shop ? db.prepare("SELECT * FROM services WHERE shop_id = ? ORDER BY updated_at DESC").all(shop.id) : [];
  const collaborators = canManageShop
    ? db
        .prepare(
          `SELECT m.user_id, m.role, u.username, u.display_name
           FROM shop_members m JOIN users u ON u.id = m.user_id
           WHERE m.shop_id = ? AND m.status = 'active'
           ORDER BY CASE m.role WHEN 'owner' THEN 0 ELSE 1 END, u.username ASC`
        )
        .all(shop.id)
    : [];
  res.render("merchant-dashboard", {
    page: "merchant",
    title: "商家管理后台",
    application,
    shop,
    managedShops,
    canManageShop,
    collaborators,
    products,
    homeListings,
    services,
    error: null
  });
});

app.post("/merchant/shops/:id/business-state", requireMerchant, (req, res) => {
  const shopId = intId(req.params.id);
  if (!shopId || !userCanManageShopFully(req.user.id, shopId)) {
    return res.status(403).render("message", { page: "merchant", title: "无权修改营业状态", message: "只有店主或店铺管理员可以修改营业状态。" });
  }
  const state = ["open", "rest", "temporary_rest"].includes(req.body.business_state) ? req.body.business_state : "open";
  db.prepare("UPDATE shops SET business_state = ?, updated_at = ? WHERE id = ? AND review_status = 'approved'").run(state, now(), shopId);
  flash(req, "success", state === "open" ? "已设置为今日营业。" : state === "rest" ? "已设置为今日休息。" : "已设置为临时休息。 ");
  res.redirect(`/merchant/dashboard?shop=${shopId}`);
});

app.post("/merchant/shops/:id/collaborators", requireMerchant, (req, res) => {
  const shopId = intId(req.params.id);
  const username = text(req.body.username, 60);
  const shop = shopId ? db.prepare("SELECT * FROM shops WHERE id = ?").get(shopId) : null;
  if (!shop || !userCanManageShopFully(req.user.id, shop.id)) {
    return res.status(403).render("message", { page: "merchant", title: "无权邀请协作人", message: "只有店主或店铺管理员可以邀请协作人。" });
  }
  const collaborator = username ? db.prepare("SELECT id, username, is_disabled FROM users WHERE username = ?").get(username) : null;
  if (!collaborator || collaborator.is_disabled) {
    flash(req, "error", "未找到可邀请的已注册账号。请确认好友用户名。 ");
    return res.redirect(`/merchant/dashboard?shop=${shop.id}#collaborators`);
  }
  if (collaborator.id === shop.user_id) {
    flash(req, "error", "店主已经拥有全部店铺管理权限，无需重复邀请。 ");
    return res.redirect(`/merchant/dashboard?shop=${shop.id}#collaborators`);
  }
  const currentMember = db.prepare("SELECT role FROM shop_members WHERE shop_id = ? AND user_id = ?").get(shop.id, collaborator.id);
  if (currentMember?.role === "owner") {
    flash(req, "error", "该账号已经是店主，不能改为协作人。 ");
    return res.redirect(`/merchant/dashboard?shop=${shop.id}#collaborators`);
  }
  db.prepare(
    `INSERT INTO shop_members (shop_id, user_id, role, status, created_at, updated_at)
     VALUES (?, ?, 'clerk', 'active', ?, ?)
     ON CONFLICT(shop_id, user_id) DO UPDATE SET role = 'clerk', status = 'active', updated_at = excluded.updated_at`
  ).run(shop.id, collaborator.id, now(), now());
  db.prepare(
    `INSERT INTO store_members (store_id, user_id, role, status, created_at, updated_at)
     VALUES (?, ?, 'staff', 'active', ?, ?)
     ON CONFLICT(store_id, user_id) DO UPDATE SET role = 'staff', status = 'active', updated_at = excluded.updated_at`
  ).run(shop.id, collaborator.id, now(), now());
  flash(req, "success", "协作人已加入，可编辑本店商品的上下架和库存状态。 ");
  res.redirect(`/merchant/dashboard?shop=${shop.id}#collaborators`);
});

app.post("/merchant/shops/:id/collaborators/:userId/remove", requireMerchant, (req, res) => {
  const shopId = intId(req.params.id);
  const userId = intId(req.params.userId);
  const shop = shopId ? db.prepare("SELECT * FROM shops WHERE id = ?").get(shopId) : null;
  if (!shop || !userId || !userCanManageShopFully(req.user.id, shop.id)) {
    return res.status(403).render("message", { page: "merchant", title: "无权移除协作人", message: "只有店主或店铺管理员可以移除协作人。" });
  }
  db.prepare("UPDATE shop_members SET status = 'inactive', updated_at = ? WHERE shop_id = ? AND user_id = ? AND role = 'clerk'").run(now(), shop.id, userId);
  db.prepare("UPDATE store_members SET status = 'inactive', updated_at = ? WHERE store_id = ? AND user_id = ? AND role = 'staff'").run(now(), shop.id, userId);
  flash(req, "success", "协作人已移除。 ");
  res.redirect(`/merchant/dashboard?shop=${shop.id}#collaborators`);
});

app.get("/merchant/barcode", requireMerchant, (req, res) => {
  res.render("message", {
    page: "merchant",
    title: "扫条形码上架",
    message: "当前版本已预留扫码上架入口。请先使用“拍照发布商品”完成第一件商品发布。"
  });
});

function managedHomeShop(req, shopId) {
  const shop = currentShopForUser(req.user.id, shopId);
  return shop && shop.business_mode === "home_shop" && userCanManageShopFully(req.user.id, shop.id) ? shop : null;
}

app.get("/merchant/home-shop/:id/publish", requireMerchant, (req, res) => {
  const shop = managedHomeShop(req, req.params.id);
  if (!shop) return renderNotFound(res);
  const listingType = ["local_produce", "secondhand", "service"].includes(req.query.type) ? req.query.type : "local_produce";
  const intent = req.query.intent === "buy" ? "buy" : "sell";
  res.render("home-shop-publish", {
    page: "publish",
    title: "发布乡邻内容",
    shop,
    listingType,
    intent,
    categories: categories().filter((category) => category.slug !== "medical"),
    error: null,
    values: {}
  });
});

app.post("/merchant/home-shop/:id/publish", requireMerchant, async (req, res) => {
  const shop = managedHomeShop(req, req.params.id);
  if (!shop) return renderNotFound(res);
  const err = await runUpload(uploadListingFiles, req, res);
  const listingType = ["local_produce", "secondhand", "service"].includes(req.body.listing_type) ? req.body.listing_type : "local_produce";
  const publishIntent = req.body.publish_intent === "buy"
    ? "buy"
    : req.body.publish_intent === "sell"
      ? "sell"
      : null;
  const renderError = (error) => {
    cleanupUploadedFiles(req);
    return res.status(400).render("home-shop-publish", {
      page: "publish",
      title: "发布乡邻内容",
      shop,
      listingType,
      intent: publishIntent || "sell",
      categories: categories().filter((category) => category.slug !== "medical"),
      error,
      values: req.body
    });
  };
  if (err) return renderError(err.message);

  let imagePaths;
  try {
    imagePaths = uploadedListingPaths(req);
  } catch (error) {
    return renderError(error.message);
  }

  if (publishIntent) {
    const name = text(req.body.name, 120);
    const description = text(req.body.description, 1200);
    const rawPrice = text(req.body.price, 40);
    const price = rawPrice ? money(rawPrice) : null;
    if (!name || !description || price === null || price > 999999) {
      return renderError(!rawPrice || price === null || price > 999999 ? "价格需在0.00到999999.00之间。" : "请填写名称和描述。");
    }
    const image = imagePaths[0] || "/assets/images/listing-placeholder.svg";
    const village = text(shop.village, 80) || text(req.user.village, 80) || "高桥镇";
    const contactPhone = text(shop.phone, 40) || text(req.user.phone, 40) || "平台消息";

    if (publishIntent === "buy") {
      db.prepare(
        `INSERT INTO wanted_posts
         (user_id, title, budget, village, description, image, needs_delivery, contact_phone, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 0, ?, 'seeking', ?, ?)`
      ).run(req.user.id, name, `${price.toFixed(2)} 元以内`, village, description, image, contactPhone, now(), now());
      imagePaths.slice(1).forEach(removeUploadedPublicFile);
      flash(req, "success", "求购信息已提交。");
      return res.redirect(`/merchant/dashboard?shop=${shop.id}`);
    }

    const category = categoryBySlug("daily") || categories()[0];
    if (!category || sensitiveContentTerms.test(`${name} ${description}`)) {
      return renderError("当前内容需要人工审核或暂不支持发布，请调整描述后重试。");
    }
    try {
      let listingId;
      db.transaction(() => {
        const created = db.prepare(
          `INSERT INTO personal_listings
           (shop_id, user_id, category_id, type, listing_type, name, image, price, unit, spec, description, stock_status, condition, village, contact_phone, pickup, delivery, delivery_area, status, publication_status, original_price, quantity, source_note, harvested_at, used_duration, defect_description, negotiable, pickup_location, created_at, updated_at)
           VALUES (?, ?, ?, 'secondhand', 'product', ?, ?, ?, '件', '', ?, '待审核', '未填写', ?, ?, 1, 0, '', 'inactive', 'pending', NULL, NULL, NULL, NULL, NULL, NULL, 0, NULL, ?, ?)`
        ).run(shop.id, req.user.id, category.id, name, image, price, description, village, contactPhone, now(), now());
        listingId = Number(created.lastInsertRowid);
        replaceListingImages(listingId, imagePaths);
      })();
    } catch (error) {
      return renderError("发布失败，请稍后重试。");
    }
    flash(req, "success", "发布信息已提交审核。");
    return res.redirect(`/merchant/dashboard?shop=${shop.id}`);
  }

  const image = imagePaths[0] || "/assets/images/listing-placeholder.svg";
  const contactPhone = text(req.body.contact_phone, 40) || shop.phone;
  if (!contactPhone) return renderError("请填写顾客可联系到你的电话或先在小铺资料中补充联系方式。");

  if (listingType === "service") {
    const title = text(req.body.title, 120);
    const description = text(req.body.description, 800);
    if (!title || !description || !text(req.body.service_area, 180) || !text(req.body.available_time, 120)) {
      return renderError("请填写服务名称、服务介绍、服务范围和可服务时间。");
    }
    try {
      db.prepare(
        `INSERT INTO services
         (shop_id, user_id, type, title, description, phone, business_hours, delivery_area, village, status, verified_only, image, listing_type, publication_status, pricing_method, created_at, updated_at)
         VALUES (?, ?, '其他服务', ?, ?, ?, ?, ?, ?, 'inactive', 0, ?, 'service', 'pending', ?, ?, ?)`
      ).run(shop.id, req.user.id, title, description, contactPhone, text(req.body.available_time, 120), text(req.body.service_area, 180), shop.village, image, text(req.body.pricing_method, 80), now(), now());
    } catch (error) {
      return renderError("发布失败，请稍后重试。");
    }
    imagePaths.slice(1).forEach(removeUploadedPublicFile);
  } else {
    const name = text(req.body.name, 120);
    const isLocalProduce = listingType === "local_produce";
    const price = isLocalProduce ? 0 : money(req.body.price);
    const category = categoryById(intId(req.body.category_id)) || (isLocalProduce ? null : categoryBySlug("daily"));
    const description = isLocalProduce
      ? text(req.body.description, 800)
      : `使用时间：${text(req.body.used_duration, 80) || "未填写"}\n瑕疵说明：${text(req.body.defect_description, 800) || "无"}`;
    if (!name || !category || !description || (!isLocalProduce && price === null)) {
      return renderError(isLocalProduce ? "请填写名称、分类、描述和联系方式。" : "请填写名称、价格和有效分类。");
    }
    if (category.slug === "medical") return renderError("乡邻小铺当前不能发布医药健康类商品。");
    if (listingType === "secondhand" && (!text(req.body.used_duration, 80) || !text(req.body.condition, 40))) return renderError("请填写使用时间和成色。");
    try {
      let listingId;
      db.transaction(() => {
        const created = db.prepare(
          `INSERT INTO personal_listings
           (shop_id, user_id, category_id, type, listing_type, name, image, price, unit, spec, description, stock_status, condition, village, contact_phone, pickup, delivery, delivery_area, status, publication_status, original_price, quantity, source_note, harvested_at, used_duration, defect_description, negotiable, pickup_location, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'inactive', 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          shop.id,
          req.user.id,
          category.id,
          isLocalProduce ? "farm" : "secondhand",
          listingType,
          name,
          image,
          price,
          "件",
          text(req.body.spec, 120),
          description,
          text(req.body.stock_status, 40) || (isLocalProduce ? "待审核" : "待审核"),
          text(req.body.condition, 40) || (isLocalProduce ? "自家发布" : "八成新"),
          shop.village,
          contactPhone,
          boolFlag(req.body.pickup) ? 1 : 0,
          boolFlag(req.body.delivery) ? 1 : 0,
          text(req.body.delivery_area, 160),
          isLocalProduce ? null : money(req.body.original_price),
          null,
          null,
          null,
          isLocalProduce ? null : text(req.body.used_duration, 80),
          isLocalProduce ? null : text(req.body.defect_description, 800),
          !isLocalProduce && boolFlag(req.body.negotiable) ? 1 : 0,
          null,
          now(),
          now()
        );
        listingId = Number(created.lastInsertRowid);
        replaceListingImages(listingId, imagePaths);
      })();
    } catch (error) {
      return renderError("发布失败，请稍后重试。");
    }
  }
  flash(req, "success", "发布信息已提交审核，审核通过后会显示“商品已审核 · 乡邻发布”。");
  res.redirect(`/merchant/dashboard?shop=${shop.id}`);
});

app.post("/merchant/products", requireMerchant, async (req, res) => {
  const shop = currentShopForUser(req.user.id, req.body.shop_id);
  if (!shop || !userCanManageShopFully(req.user.id, shop.id)) {
    return res.status(403).render("message", { page: "merchant", title: "无法发布商品", message: "商家认证通过后才能发布商品。" });
  }
  if (shop.business_mode === "home_shop") {
    return res.redirect(`/merchant/home-shop/${shop.id}/publish`);
  }
  const err = await runUpload(uploadProductFiles, req, res);
  if (err) {
    flash(req, "error", err.message);
    return res.redirect(`/merchant/dashboard?shop=${intId(req.body.shop_id) || ""}`);
  }
  const categoryId = intId(req.body.category_id);
  const category = categoryId ? categoryById(categoryId) : null;
  const name = text(req.body.name, 120);
  const price = money(req.body.price);
  const imagePaths = uploadedProductPaths(req);
  if (!name || !category || price === null || !text(req.body.description, 1200)) {
    cleanupUploadedFiles(req);
    flash(req, "error", "请完整填写商品名称、分类、价格和描述。");
    return res.redirect(`/merchant/dashboard?shop=${shop.id}`);
  }
  const image = imagePaths[0] || "/assets/images/product-placeholder.svg";
  const decision = publicationDecision({ shop, category, name, description: text(req.body.description, 1200) });
  const createdProduct = db.prepare(
    `INSERT INTO products
     (shop_id, user_id, category_id, publish_type, name, image, price, unit, spec, description, stock_status, condition, village, contact_phone, pickup, delivery, delivery_area, status, created_at, updated_at)
     VALUES (?, ?, ?, '商家新品', ?, ?, ?, ?, ?, ?, ?, '新品', ?, ?, ?, ?, ?, 'active', ?, ?)`
  ).run(
    shop.id,
    req.user.id,
    category.id,
    name,
    image,
    price,
    text(req.body.unit, 30) || "件",
    text(req.body.spec, 120),
    text(req.body.description, 1200),
    text(req.body.stock_status, 40) || "有货",
    text(req.body.village, 80) || "高桥镇",
    text(req.body.contact_phone, 40) || shop.phone,
    boolFlag(req.body.pickup) ? 1 : 0,
    boolFlag(req.body.delivery) ? 1 : 0,
    text(req.body.delivery_area, 160) || shop.delivery_area,
    now(),
    now()
  );
  db.prepare("UPDATE products SET listing_type = 'product', publication_status = ?, status = ?, review_reason = NULL, reviewed_by = NULL, reviewed_at = NULL WHERE id = ?").run(
    decision.publicationStatus,
    decision.legacyStatus,
    createdProduct.lastInsertRowid
  );
  replaceProductImages(Number(createdProduct.lastInsertRowid), imagePaths);
  flash(req, "success", "商品已发布。");
  flash(req, "success", decision.needsReview ? "商品已提交审核，审核通过后会公开展示。" : "商品已发布。");
  res.redirect(`/merchant/dashboard?shop=${shop.id}#products`);
});

app.get("/merchant/products/:id/edit", requireMerchant, (req, res) => {
  const id = intId(req.params.id);
  const product = id ? decorateProduct(db.prepare(productQuery("p.id = ?", "p.updated_at DESC")).get(id)) : null;
  if (!product || !userOwnsProduct(req.user.id, id)) return renderNotFound(res);
  res.render("merchant-product-edit", {
    page: "merchant",
    title: "编辑商品",
    product,
    existingImages: productImagesFor(product).filter((image) => image.image_path.startsWith("/uploads/products/")),
    error: null
  });
});

app.post("/merchant/products/:id/edit", requireMerchant, async (req, res) => {
  const id = intId(req.params.id);
  const product = id ? decorateProduct(db.prepare(productQuery("p.id = ?", "p.updated_at DESC")).get(id)) : null;
  if (!product || !userOwnsProduct(req.user.id, id)) return renderNotFound(res);
  const err = await runUpload(uploadProductFiles, req, res);
  if (err) {
    return res.status(400).render("merchant-product-edit", {
      page: "merchant",
      title: "编辑商品",
      product,
      existingImages: productImagesFor(product).filter((image) => image.image_path.startsWith("/uploads/products/")),
      error: err.message
    });
  }
  const categoryId = intId(req.body.category_id);
  const category = categoryId ? categoryById(categoryId) : null;
  const price = money(req.body.price);
  const keptImages = Array.isArray(req.body.keep_images) ? req.body.keep_images : req.body.keep_images ? [req.body.keep_images] : [];
  const previousImages = productImagesFor(product).map((image) => image.image_path).filter((imagePath) => imagePath.startsWith("/uploads/products/"));
  const requestedImagePaths = [...keptImages, ...uploadedProductPaths(req)].filter((imagePath) => String(imagePath).startsWith("/uploads/products/"));
  const finalImagePaths = uniqueProductImagePaths(requestedImagePaths);
  if (new Set(requestedImagePaths).size > MAX_LISTING_IMAGES) {
    cleanupUploadedFiles(req);
    return res.status(400).render("merchant-product-edit", {
      page: "merchant",
      title: "编辑商品",
      product,
      existingImages: productImagesFor(product).filter((image) => image.image_path.startsWith("/uploads/products/")),
      error: `最多上传${MAX_LISTING_IMAGES}张图片`
    });
  }
  if (!text(req.body.name, 120) || !category || price === null) {
    cleanupUploadedFiles(req);
    return res.status(400).render("merchant-product-edit", {
      page: "merchant",
      title: "编辑商品",
      product: { ...product, ...req.body },
      existingImages: productImagesFor(product).filter((image) => image.image_path.startsWith("/uploads/products/")),
      error: "请填写有效商品名称、分类和价格。"
    });
  }
  const image = finalImagePaths[0] || "/assets/images/product-placeholder.svg";
  db.prepare(
    `UPDATE products
     SET category_id = ?, name = ?, image = ?, price = ?, unit = ?, spec = ?, description = ?, stock_status = ?, condition = ?,
         village = ?, contact_phone = ?, pickup = ?, delivery = ?, delivery_area = ?, updated_at = ?
     WHERE id = ?`
  ).run(
    category.id,
    text(req.body.name, 120),
    image,
    price,
    text(req.body.unit, 30) || product.unit,
    text(req.body.spec, 120),
    text(req.body.description, 1200),
    text(req.body.stock_status, 40) || product.stock_status,
    text(req.body.condition, 40) || product.condition,
    text(req.body.village, 80),
    text(req.body.contact_phone, 40),
    boolFlag(req.body.pickup) ? 1 : 0,
    boolFlag(req.body.delivery) ? 1 : 0,
    text(req.body.delivery_area, 160),
    now(),
    id
  );
  const shop = db.prepare("SELECT * FROM shops WHERE id = ?").get(product.shop_id);
  const decision = publicationDecision({ shop, category, name: text(req.body.name, 120), description: text(req.body.description, 1200) });
  db.prepare("UPDATE products SET publication_status = ?, status = ?, review_reason = NULL, reviewed_by = NULL, reviewed_at = NULL WHERE id = ?").run(
    decision.publicationStatus,
    decision.legacyStatus,
    id
  );
  replaceProductImages(id, finalImagePaths);
  previousImages.filter((imagePath) => !finalImagePaths.includes(imagePath)).forEach(removeUploadedPublicFile);
  flash(req, "success", decision.needsReview ? "商品已更新并重新提交审核。" : "商品已更新。 ");
  res.redirect(`/merchant/dashboard?shop=${product.shop_id}#products`);
});

app.post("/merchant/products/:id/status", requireMerchant, (req, res) => {
  const id = intId(req.params.id);
  const product = id ? db.prepare("SELECT shop_id, publication_status FROM products WHERE id = ?").get(id) : null;
  if (!product || !userCanUpdateProductStatus(req.user.id, id)) {
    return res.status(403).render("message", { page: "merchant", title: "无权修改商品状态", message: "仅店主、店铺管理员或受邀协作人可以修改商品状态。" });
  }
  const status = req.body.status === "inactive" ? "inactive" : "active";
  if (status === "active" && product.publication_status !== "published") {
    flash(req, "error", "该商品仍在审核、被拒绝或已下架，不能直接上架。请等待审核通过或重新提交。 ");
    return res.redirect(`/merchant/dashboard?shop=${product.shop_id}#products`);
  }
  db.prepare("UPDATE products SET status = ?, updated_at = ? WHERE id = ?").run(status, now(), id);
  flash(req, "success", status === "active" ? "商品已上架。" : "商品已下架。");
  res.redirect(`/merchant/dashboard?shop=${product.shop_id}#products`);
});

app.post("/merchant/products/:id/stock-status", requireMerchant, (req, res) => {
  const id = intId(req.params.id);
  const product = id ? db.prepare("SELECT shop_id FROM products WHERE id = ?").get(id) : null;
  if (!product || !userCanUpdateProductStatus(req.user.id, id)) {
    return res.status(403).render("message", { page: "merchant", title: "无权修改库存状态", message: "仅店主、店铺管理员或受邀协作人可以修改库存状态。" });
  }
  const stockStatus = text(req.body.stock_status, 40);
  if (!stockStatus) {
    flash(req, "error", "请填写商品库存状态。 ");
    return res.redirect(`/merchant/dashboard?shop=${product.shop_id}#products`);
  }
  db.prepare("UPDATE products SET stock_status = ?, updated_at = ? WHERE id = ?").run(stockStatus, now(), id);
  flash(req, "success", "商品库存状态已更新。 ");
  res.redirect(`/merchant/dashboard?shop=${product.shop_id}#products`);
});

app.post("/merchant/products/:id/delete", requireMerchant, (req, res) => {
  const id = intId(req.params.id);
  const product = id ? decorateProduct(db.prepare(productQuery("p.id = ?", "p.updated_at DESC")).get(id)) : null;
  if (!product || !userOwnsProduct(req.user.id, id)) {
    return res.status(403).render("message", {
      page: "merchant",
      title: "无权删除商品",
      message: "只有店主或店铺管理员可以删除该商品。"
    });
  }

  const imagePaths = [...new Set(productImagesFor(product).map((image) => image.image_path).filter((imagePath) => imagePath.startsWith("/uploads/products/")))];
  try {
    db.transaction(() => {
      db.prepare("DELETE FROM item_comments WHERE target_type = 'product' AND target_id = ?").run(id);
      db.prepare("DELETE FROM reports WHERE target_type = 'product' AND target_id = ?").run(id);
      deleteMessageThreadsForTarget("product", id);
      db.prepare("DELETE FROM product_images WHERE product_id = ?").run(id);
      const result = db.prepare("DELETE FROM products WHERE id = ?").run(id);
      if (result.changes !== 1) throw new Error("商品删除失败");
    })();
  } catch (error) {
    console.error("删除商家商品失败", error);
    return res.status(500).render("message", {
      page: "merchant",
      title: "删除失败",
      message: "商品未删除，请稍后重试。"
    });
  }

  imagePaths.forEach(removeUploadedPublicFile);
  flash(req, "success", "商品及其图片、评论已全部删除。");
  res.redirect(`/merchant/dashboard?shop=${product.shop_id}#products`);
});

app.post("/merchant/services", requireMerchant, (req, res) => {
  const shop = currentShopForUser(req.user.id, req.body.shop_id);
  if (!shop || !userCanManageShopFully(req.user.id, shop.id)) {
    return res.status(403).render("message", { page: "merchant", title: "无法发布服务", message: "商家认证通过后才能发布便民服务。" });
  }
  if (shop.business_mode === "home_shop") {
    return res.redirect(`/merchant/home-shop/${shop.id}/publish?type=service`);
  }
  const type = serviceTypes.includes(req.body.type) ? req.body.type : "其他服务";
  if (type === "药店送药" && !/[药医健康]/.test(shop.business_scope)) {
    flash(req, "error", "药店送药只允许经营范围包含药店、医药或健康服务的已核验商家发布。");
    return res.redirect(`/merchant/dashboard?shop=${shop.id}#services`);
  }
  const title = text(req.body.title, 120) || type;
  const description = text(req.body.description, 800);
  const phone = text(req.body.phone, 40) || shop.phone;
  const businessHours = text(req.body.business_hours, 120) || shop.business_hours;
  const deliveryArea = text(req.body.delivery_area, 180) || shop.delivery_area;
  const village = text(req.body.village, 80) || req.user.village || "高桥镇";
  if (!title || !description || !phone || !businessHours || !deliveryArea) {
    flash(req, "error", "请填写服务名称、说明、电话、营业时间和服务范围。");
    return res.redirect(`/merchant/dashboard?shop=${shop.id}#services`);
  }
  db.prepare(
    `INSERT INTO services
     (shop_id, type, title, description, phone, business_hours, delivery_area, village, status, verified_only, image, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)`
  ).run(
    shop.id,
    type,
    title,
    description,
    phone,
    businessHours,
    deliveryArea,
    village,
    type === "药店送药" ? 1 : 0,
    serviceImages[type] || serviceImages["其他服务"],
    now(),
    now()
  );
  flash(req, "success", "便民服务已发布。");
  res.redirect(`/merchant/dashboard?shop=${shop.id}#services`);
});

app.get("/merchant/services/:id/edit", requireMerchant, (req, res) => {
  const id = intId(req.params.id);
  const service = id ? db.prepare("SELECT sv.*, s.business_mode FROM services sv JOIN shops s ON s.id = sv.shop_id WHERE sv.id = ?").get(id) : null;
  if (!service || !userOwnsService(req.user.id, id)) return renderNotFound(res);
  res.render("merchant-service-edit", {
    page: "merchant",
    title: "编辑服务发布",
    service,
    error: null
  });
});

app.post("/merchant/services/:id/edit", requireMerchant, async (req, res) => {
  const id = intId(req.params.id);
  const service = id ? db.prepare("SELECT sv.*, s.business_mode FROM services sv JOIN shops s ON s.id = sv.shop_id WHERE sv.id = ?").get(id) : null;
  if (!service || !userOwnsService(req.user.id, id)) return renderNotFound(res);
  const err = await runUpload(uploadListing.single("image"), req, res);
  const renderError = (error) =>
    res.status(400).render("merchant-service-edit", {
      page: "merchant",
      title: "编辑服务发布",
      service: { ...service, ...req.body },
      error
    });
  if (err) return renderError(err.message);
  const title = text(req.body.title, 120);
  const description = text(req.body.description, 800);
  const phone = text(req.body.phone, 40);
  const serviceArea = text(req.body.delivery_area, 180);
  const availableTime = text(req.body.business_hours, 120);
  if (!title || !description || !phone || !serviceArea || !availableTime) {
    return renderError("请完整填写服务名称、介绍、联系电话、服务范围和可服务时间。 ");
  }
  const image = req.file ? `/uploads/listings/${req.file.filename}` : service.image;
  const resubmittingHomeService = service.business_mode === "home_shop";
  db.prepare(
    `UPDATE services
     SET title = ?, description = ?, phone = ?, business_hours = ?, delivery_area = ?, image = ?,
         status = ?, publication_status = ?, review_reason = NULL, reviewed_by = NULL, reviewed_at = NULL, updated_at = ?
     WHERE id = ?`
  ).run(
    title,
    description,
    phone,
    availableTime,
    serviceArea,
    image,
    resubmittingHomeService ? "inactive" : service.status,
    resubmittingHomeService ? "pending" : service.publication_status,
    now(),
    id
  );
  flash(req, "success", resubmittingHomeService ? "服务已更新并重新提交审核。" : "服务已更新。 ");
  res.redirect(`/merchant/dashboard?shop=${service.shop_id}#services`);
});

app.post("/merchant/services/:id/status", requireMerchant, (req, res) => {
  const id = intId(req.params.id);
  const service = id ? db.prepare("SELECT sv.shop_id, sv.publication_status, s.business_mode FROM services sv JOIN shops s ON s.id = sv.shop_id WHERE sv.id = ?").get(id) : null;
  if (!service || !userOwnsService(req.user.id, id)) return renderNotFound(res);
  const status = req.body.status === "inactive" ? "inactive" : "active";
  if (status === "active" && service.business_mode === "home_shop" && service.publication_status !== "published") {
    flash(req, "error", "该乡邻服务尚未通过审核，不能直接上架。 ");
    return res.redirect(`/merchant/dashboard?shop=${service.shop_id}#services`);
  }
  db.prepare("UPDATE services SET status = ?, updated_at = ? WHERE id = ?").run(status, now(), id);
  flash(req, "success", status === "active" ? "服务已上架。" : "服务已下架。");
  res.redirect(`/merchant/dashboard?shop=${service.shop_id}#services`);
});

app.get("/admin/licenses/:filename", requireAdmin, (req, res) => {
  const filename = path.basename(req.params.filename);
  const file = path.join(rootDir, "data", "licenses", filename);
  if (!fs.existsSync(file)) return renderNotFound(res);
  res.sendFile(file);
});

app.get("/admin", requireAdmin, (req, res) => res.redirect("/admin/dashboard"));

app.get("/admin/dashboard", requireAdmin, (req, res) => {
  const applications = db
    .prepare(
      `SELECT a.*, u.username AS username
       FROM merchant_applications a
       LEFT JOIN users u ON u.id = a.user_id
       ORDER BY CASE a.status WHEN 'pending' THEN 0 ELSE 1 END, a.updated_at DESC`
    )
    .all();
  const products = db.prepare(productQuery("1 = 1", "p.updated_at DESC", 80)).all();
  const services = db
    .prepare(
      `SELECT sv.*, s.name AS shop_name
       FROM services sv
       LEFT JOIN shops s ON s.id = sv.shop_id
       ORDER BY sv.updated_at DESC LIMIT 80`
    )
    .all();
  const listings = db.prepare(listingQuery("1 = 1", "l.updated_at DESC", 80)).all();
  const wanted = db
    .prepare("SELECT w.*, u.username AS owner_name FROM wanted_posts w LEFT JOIN users u ON u.id = w.user_id ORDER BY w.updated_at DESC LIMIT 80")
    .all();
  const reports = db
    .prepare("SELECT r.*, u.username AS reporter_name FROM reports r LEFT JOIN users u ON u.id = r.reporter_user_id ORDER BY r.created_at DESC LIMIT 80")
    .all();
  const users = db
    .prepare("SELECT id, username, role, phone, village, is_disabled, created_at FROM users ORDER BY created_at DESC LIMIT 80")
    .all();
  res.render("admin-dashboard", {
    page: "admin",
    title: "管理员审核后台",
    applications,
    products,
    services,
    listings,
    wanted,
    reports,
    users
  });
});

app.post("/admin/applications/:id/review", requireAdmin, (req, res) => {
  const id = intId(req.params.id);
  const application = id ? db.prepare("SELECT * FROM merchant_applications WHERE id = ?").get(id) : null;
  if (!application) return renderNotFound(res);
  const action = req.body.action === "approve" ? "approve" : "reject";
  const reviewNote = text(req.body.review_note, 300);
  const rejectionReason = action === "reject" ? text(req.body.rejection_reason, 300) : null;
  if (action === "reject" && !rejectionReason) {
    flash(req, "error", "拒绝申请时必须填写拒绝理由。");
    return res.redirect("/admin/dashboard#applications");
  }

  const linkedShop = db.prepare("SELECT id FROM shops WHERE application_id = ?").get(id);
  if (action === "approve" && !linkedShop && getOwnedShop(application.user_id)) {
    flash(req, "error", "该申请人已经拥有店铺，不能通过第二个店铺申请。");
    return res.redirect("/admin/dashboard#applications");
  }

  const tx = db.transaction(() => {
    db.prepare(
      `UPDATE merchant_applications
       SET status = ?, rejection_reason = ?, reviewed_at = ?, reviewed_by = ?, review_note = ?, updated_at = ?
       WHERE id = ?`
    ).run(action === "approve" ? "approved" : "rejected", rejectionReason, now(), req.user.id, reviewNote, now(), id);

    if (action === "approve") {
      if (linkedShop) {
        db.prepare(
          `UPDATE shops
           SET name = ?, address = ?, phone = ?, business_hours = ?, business_scope = ?, delivery_area = ?,
               verified = 1, status = 'active', review_status = 'approved', merchant_type = 'entity',
               business_mode = 'verified_store', verification_label = 'platform_verified', updated_at = ?
           WHERE id = ?`
        ).run(
          application.shop_name,
          application.address,
          application.phone,
          application.business_hours,
          application.business_scope,
          application.delivery_area,
          now(),
          linkedShop.id
        );
      } else {
        db.prepare(
          `INSERT INTO shops
           (user_id, application_id, name, address, phone, business_hours, business_scope, delivery_area, verified, status, logo_image, review_status, merchant_type, business_mode, verification_label, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 'active', '/assets/images/shop-placeholder.svg', 'approved', 'entity', 'verified_store', 'platform_verified', ?, ?)`
        ).run(
          application.user_id,
          id,
          application.shop_name,
          application.address,
          application.phone,
          application.business_hours,
          application.business_scope,
          application.delivery_area,
          now(),
          now()
        );
      }
    }
  });
  tx();
  if (action === "approve") {
    const approvedShop = db.prepare("SELECT id FROM shops WHERE application_id = ?").get(id);
    if (approvedShop) {
      ensureStoreOwnerMembership(approvedShop.id, application.user_id);
      if (application.license_image) {
        db.prepare(
          `INSERT INTO shop_credentials (shop_id, credential_type, file_name, original_name, created_at)
           SELECT ?, 'business_license', ?, '旧入驻申请营业执照', ?
           WHERE NOT EXISTS (SELECT 1 FROM shop_credentials WHERE shop_id = ? AND credential_type = 'business_license')`
        ).run(approvedShop.id, application.license_image, now(), approvedShop.id);
      }
    }
  }
  flash(req, "success", action === "approve" ? "商家已通过核验。" : "商家申请已拒绝。");
  res.redirect("/admin/dashboard#applications");
});

app.post("/admin/products/:id/status", requireAdmin, (req, res) => {
  const id = intId(req.params.id);
  const status = req.body.status === "active" ? "active" : "inactive";
  if (!id) return renderNotFound(res);
  const product = db.prepare("SELECT publication_status FROM products WHERE id = ?").get(id);
  if (!product) return renderNotFound(res);
  if (status === "active" && product.publication_status !== "published") {
    flash(req, "error", "待审核内容请在店铺审核页的内容审核队列中通过后再公开。 ");
    return res.redirect("/admin/shop-reviews#content");
  }
  db.prepare("UPDATE products SET status = ?, publication_status = ?, updated_at = ? WHERE id = ?").run(status, status === "active" ? "published" : "offline", now(), id);
  flash(req, "success", "商品状态已更新。");
  res.redirect("/admin/dashboard#products");
});

app.post("/admin/services/:id/status", requireAdmin, (req, res) => {
  const id = intId(req.params.id);
  const status = req.body.status === "active" ? "active" : "inactive";
  if (!id) return renderNotFound(res);
  const service = db.prepare("SELECT publication_status FROM services WHERE id = ?").get(id);
  if (!service) return renderNotFound(res);
  if (status === "active" && service.publication_status !== "published") {
    flash(req, "error", "待审核内容请在店铺审核页的内容审核队列中通过后再公开。 ");
    return res.redirect("/admin/shop-reviews#content");
  }
  db.prepare("UPDATE services SET status = ?, publication_status = ?, updated_at = ? WHERE id = ?").run(status, status === "active" ? "published" : "offline", now(), id);
  flash(req, "success", "便民服务状态已更新。");
  res.redirect("/admin/dashboard#services");
});

app.post("/admin/listings/:id/status", requireAdmin, (req, res) => {
  const id = intId(req.params.id);
  const status = req.body.status === "active" ? "active" : "inactive";
  if (!id) return renderNotFound(res);
  const listing = db.prepare("SELECT publication_status FROM personal_listings WHERE id = ?").get(id);
  if (!listing) return renderNotFound(res);
  if (status === "active" && listing.publication_status !== "published") {
    flash(req, "error", "待审核内容请在店铺审核页的内容审核队列中通过后再公开。 ");
    return res.redirect("/admin/shop-reviews#content");
  }
  db.prepare("UPDATE personal_listings SET status = ?, publication_status = ?, updated_at = ? WHERE id = ?").run(status, status === "active" ? "published" : "offline", now(), id);
  flash(req, "success", "个人发布状态已更新。");
  res.redirect("/admin/dashboard#listings");
});

app.post("/admin/wanted/:id/status", requireAdmin, (req, res) => {
  const id = intId(req.params.id);
  const status = ["seeking", "found", "closed"].includes(req.body.status) ? req.body.status : "closed";
  if (!id) return renderNotFound(res);
  db.prepare("UPDATE wanted_posts SET status = ?, updated_at = ? WHERE id = ?").run(status, now(), id);
  flash(req, "success", "求购状态已更新。");
  res.redirect("/admin/dashboard#wanted");
});

app.post("/admin/reports/:id/status", requireAdmin, (req, res) => {
  const id = intId(req.params.id);
  const status = req.body.status === "resolved" ? "resolved" : "open";
  if (!id) return renderNotFound(res);
  db.prepare("UPDATE reports SET status = ?, resolved_at = ? WHERE id = ?").run(status, status === "resolved" ? now() : null, id);
  flash(req, "success", "举报状态已更新。");
  res.redirect("/admin/dashboard#reports");
});

app.post("/admin/users/:id/toggle", requireAdmin, (req, res) => {
  const id = intId(req.params.id);
  if (!id || id === req.user.id) {
    flash(req, "error", "不能禁用当前管理员账号。");
    return res.redirect("/admin/dashboard#users");
  }
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(id);
  if (!user) return renderNotFound(res);
  db.prepare("UPDATE users SET is_disabled = ? WHERE id = ?").run(user.is_disabled ? 0 : 1, id);
  flash(req, "success", user.is_disabled ? "账号已启用。" : "账号已禁用。");
  res.redirect("/admin/dashboard#users");
});

app.post("/comments", requireAuth, (req, res) => {
  const targetType = ["product", "listing"].includes(req.body.target_type) ? req.body.target_type : null;
  const targetId = intId(req.body.target_id);
  const content = text(req.body.content, 500);
  const target = targetType === "product"
    ? db.prepare("SELECT id FROM products WHERE id = ? AND status = 'active'").get(targetId)
    : targetType === "listing"
      ? db.prepare("SELECT id FROM personal_listings WHERE id = ? AND status = 'active' AND publication_status = 'published'").get(targetId)
      : null;
  const returnUrl = targetType === "product" ? `/products/${targetId}#comments` : `/listings/${targetId}#comments`;
  if (!target || !content) {
    flash(req, "error", "评论不能为空，或该商品已经下架。");
    return res.redirect(targetId ? returnUrl : "/");
  }
  db.prepare(
    `INSERT INTO item_comments (target_type, target_id, user_id, content, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'visible', ?, ?)`
  ).run(targetType, targetId, req.user.id, content, now(), now());
  flash(req, "success", "评论已发布。");
  res.redirect(returnUrl);
});

app.post("/comments/:id/delete", requireAuth, (req, res) => {
  const id = intId(req.params.id);
  const comment = id ? db.prepare("SELECT * FROM item_comments WHERE id = ?").get(id) : null;
  if (!comment) return renderNotFound(res);
  if (comment.user_id !== req.user.id) {
    return res.status(403).render("message", {
      page: "forbidden",
      title: "不能删除这条评论",
      message: "只能删除自己发表的评论。"
    });
  }

  db.prepare("DELETE FROM item_comments WHERE id = ? AND user_id = ?").run(id, req.user.id);
  flash(req, "success", "评论已删除。");
  const returnUrl = comment.target_type === "product"
    ? `/products/${comment.target_id}#comments`
    : `/listings/${comment.target_id}#comments`;
  res.redirect(returnUrl);
});

app.post("/reports", requireAuth, (req, res) => {
  const targetType = ["product", "listing", "wanted", "shop", "service"].includes(req.body.target_type) ? req.body.target_type : null;
  const targetId = intId(req.body.target_id);
  const reason = text(req.body.reason, 120);
  const detail = text(req.body.detail, 800);
  if (!targetType || !targetId || !reason) {
    flash(req, "error", "请填写举报原因。");
    return res.redirect(req.headers.referer || "/");
  }
  db.prepare(
    "INSERT INTO reports (reporter_user_id, target_type, target_id, reason, detail, status, created_at) VALUES (?, ?, ?, ?, ?, 'open', ?)"
  ).run(req.user.id, targetType, targetId, reason, detail, now());
  flash(req, "success", "举报已提交，管理员会处理。");
  res.redirect(req.headers.referer || "/");
});

registerShopOnboarding(app, {
  db,
  rootDir,
  now,
  text,
  intId,
  boolFlag,
  flash,
  requireAuth,
  requireAdmin,
  renderNotFound,
  userManagesShop
});

app.use((req, res) => renderNotFound(res));

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).render("message", {
    page: "error",
    title: "服务暂时不可用",
    message: "服务器处理请求时出错，请稍后再试。"
  });
});

module.exports = {
  app,
  db
};
